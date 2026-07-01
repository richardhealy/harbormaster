# Integration guide

This guide is for standing harbormaster up and wiring another system to it.
It covers the three integration surfaces separately:

- [Standing up the control plane](#standing-up-the-control-plane) — Postgres,
  migrations, environment configuration.
- [GitHub integration](#github-integration) — the GitHub App, webhooks, and
  the branch-protection setup the merge queue relies on.
- [Linear integration](#linear-integration) — the API key, what gets synced,
  and how release manifests pull from it.
- [Driving harbormaster from an agent runtime](#driving-harbormaster-from-an-agent-runtime)
  — the MCP server, the fastest path for Claude Code / Cursor / any
  MCP-compatible client.
- [Driving harbormaster from a script or CI job](#driving-harbormaster-from-a-script-or-ci-job)
  — the CLI, for orchestration code that isn't itself an MCP client.
- [End-to-end walkthrough](#end-to-end-walkthrough) — all of the above
  chained into one scheduling → merge → release cycle.

For the full request/response shape of every command, see
[`docs/api.md`](./api.md). For how the pieces fit together internally, see
[`docs/architecture.md`](./architecture.md). This guide only covers getting
data in and out from the outside.

## Standing up the control plane

### Prerequisites

- Node 20+
- Postgres 14+ reachable from wherever the control-plane process and CLI run

### Install and configure

```bash
git clone <this repo>
cd harbormaster
npm install
cp .env.example .env
```

Edit `.env`:

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | No | `postgresql://localhost:5432/harbormaster` | Postgres connection string |
| `GITHUB_APP_ID` | No | — | See [GitHub integration](#github-integration) |
| `GITHUB_APP_PRIVATE_KEY` | No | — | PEM contents, one line with `\n` escapes, or read from a file at deploy time |
| `GITHUB_WEBHOOK_SECRET` | No | — | Shared secret configured on the GitHub App's webhook |
| `LINEAR_API_KEY` | No | — | See [Linear integration](#linear-integration) |
| `PORT` | No | `3000` | Control-plane process port (not currently bound to an HTTP server — reserved for future use) |
| `NODE_ENV` | No | `development` | `development` \| `test` \| `production` |

Every integration is optional at boot. `loadConfig()` (`src/config.ts`)
validates whatever is present and defaults the rest; `createGitHubApp()`
(`src/integrations/github/index.ts`) returns `null` instead of throwing when
GitHub credentials are absent. This means you can run the scheduler, gates,
and hotspot leases — the parts of the spec that need no external service —
with zero configuration, and add GitHub/Linear/Postgres only once you need
provenance, releases, or the merge queue.

### Database

Create the database, then run the migration runner once before starting
anything that touches `provenance_*` or `release_*` commands:

```bash
createdb harbormaster   # or point DATABASE_URL at an existing instance
```

```typescript
import { getPool } from './src/db'
import { runMigrations } from './src/db/migrate'

await runMigrations(getPool(), './src/db/migrations')
```

This applies `src/db/migrations/001_initial.sql`, which creates
`audit_log`, `tickets`, `dispatches`, `gate_decisions`, and `releases`. Each
migration runs inside its own transaction and the runner tracks which have
already applied, so it's safe to run on every deploy.

### Control-plane process

```bash
npm run dev     # tsx watch mode
npm run build && npm start   # compiled
```

`src/index.ts` loads config, checks the database connection, and — if
GitHub credentials are set — initializes the GitHub App and registers its
webhook handlers. Database and GitHub failures are logged as warnings, not
fatal errors: the process still comes up so the CLI/MCP commands that don't
need those integrations keep working. There is currently no HTTP server
bound to `PORT`; the control-plane process's job is booting the GitHub App
listener and holding the DB pool, not serving requests. The commands another
system actually calls live in the agent interface (below), not here.

## GitHub integration

harbormaster does not implement a merge queue — it wraps GitHub's native
one (`GitHubMergeQueueAdapter`, `src/integration/queue/`) and enforces the
spec's "no direct pushes to main" rule via a GitHub App.

### Create the GitHub App

1. GitHub → Settings → Developer settings → GitHub Apps → New GitHub App.
2. Permissions: **Contents** (read/write), **Pull requests** (read/write),
   **Checks** (read), **Metadata** (read).
3. Subscribe to events: `push`, `pull_request`, `check_suite`, `merge_group`.
4. Set the webhook URL to wherever your deployment exposes webhook
   ingestion, and generate a webhook secret.
5. Generate a private key (PEM) and download it.
6. Install the app on the target repository.

Set the three env vars from that app: `GITHUB_APP_ID`,
`GITHUB_APP_PRIVATE_KEY` (the PEM contents), `GITHUB_WEBHOOK_SECRET`. With
all three present, `src/index.ts` calls `registerWebhooks()`
(`src/integrations/github/webhooks.ts`), which currently:

- logs a warning when a push lands directly on `refs/heads/main` (the hook
  point for turning this into a hard block via branch protection, or into a
  `provenance_record` call — see [Provenance](./api.md#provenance));
- logs merged PRs and completed check suites.

### Branch protection and the merge queue

harbormaster's queue adapter assumes GitHub's native merge queue is enabled
on the target branch:

1. Repo → Settings → Branches → branch protection rule for `main` (or your
   integration branch).
2. Require status checks to pass before merging; select the checks your CI
   produces.
3. Enable **Require merge queue**.
4. Require pull requests before merging, and disable direct pushes — this is
   what the spec's "no direct main pushes" guarantee ultimately rests on;
   the webhook log is observability on top of it, not the enforcement
   itself.

Once that's configured, `GitHubMergeQueueAdapter.enqueue(prNumber,
mergeMethod, dispatchId)` (`src/integration/queue/`) enables auto-merge on a
PR, which is what actually submits it to GitHub's merge queue:

```typescript
import { GitHubMergeQueueAdapter } from './src/integration/queue'
import { App } from '@octokit/app'

const app = createGitHubApp()! // non-null once the three env vars are set
const octokit = await app.getInstallationOctokit(installationId)
const queue = new GitHubMergeQueueAdapter(octokit, 'your-org', 'your-repo')

await queue.enqueue(42, 'squash', 'disp-1')
```

`GitHubMergeQueueAdapter.updateStatus(prNumber, status)` is the other half —
call it from your `merge_group` webhook handler so `getStatus`/`listQueued`
reflect GitHub's actual queue state rather than only the auto-merge flag.

### Worktrees, rebase, and CI-on-result

The rest of the optimistic-integration loop (`src/integration/worktrees/`,
`src/integration/rerun/`) operates on a local clone via `simple-git` and the
GitHub REST checks API — no additional GitHub App configuration beyond the
scopes above. See the [Scheduler](../README.md#scheduler-srcimpact--srcscheduler)
and [Queue adapter](../README.md#queue-adapter-srcintegrationqueue) sections
of the README for the worktree/rebase/rerun code paths; this guide covers
only the external wiring.

## Linear integration

`LinearClient` (`src/integrations/linear/index.ts`) is a thin GraphQL client
against `https://api.linear.app/graphql`.

### Get an API key

Linear → Settings → API → Personal API keys (or a workspace API key for a
service account) → create a key with read access to issues, and write
access if you want `updateTicketStatus` to work. Set `LINEAR_API_KEY`.

### What syncs, and when

- `TicketSyncer.syncTeamTickets(teamId, options)`
  (`src/integrations/linear/sync.ts`) pulls a team's issues via
  `LinearClient.listTeamIssues` and upserts each into the `tickets` table —
  this is a pull you run on a schedule or trigger yourself; harbormaster has
  no Linear webhook listener.
- `release_manifest` (`src/agent-iface/commands.ts`, wrapping
  `ReleaseManager.buildManifest`) calls Linear directly at manifest-build
  time rather than reading the synced `tickets` table, so a release manifest
  always reflects Linear's current state, not the last sync.
- `updateTicketStatus` is available on the client for pushing dispatch
  outcomes back to Linear (e.g. moving a ticket to "In Review" on dispatch,
  "Done" on merge) — wire it into your own dispatch lifecycle; harbormaster
  doesn't call it automatically.

### Calling it directly

```typescript
import { LinearClient } from './src/integrations/linear'

const linear = new LinearClient(process.env.LINEAR_API_KEY!)

const ticket = await linear.getTicket('ENG-123')
const states = await linear.getWorkflowStates(teamId)
await linear.updateTicketStatus(ticket.id, states.find(s => s.name === 'Done')!.id)
```

Or through the agent interface, which needs no direct `LinearClient` import
— `release_manifest` builds one internally from `LINEAR_API_KEY`:

```bash
harbormaster release manifest '{ "releaseId": "<id>", "teamId": "team-eng" }'
```

## Driving harbormaster from an agent runtime

This is the primary integration surface — the one the spec's "agents drive
the loop through MCP tools, not just the CLI" checklist item targets. Any
MCP-compatible client (Claude Code, Cursor, a custom agent runtime) can
spawn the harbormaster MCP server as a subprocess tool provider.

### Point a client at it

```bash
npm run build
```

Then register it as an MCP server, stdio transport, in the client's config.
For Claude Code (`.mcp.json` or `claude mcp add`):

```json
{
  "mcpServers": {
    "harbormaster": {
      "command": "node",
      "args": ["/absolute/path/to/harbormaster/dist/agent-iface/mcp/index.js"],
      "env": {
        "DATABASE_URL": "postgresql://localhost:5432/harbormaster",
        "LINEAR_API_KEY": "lin_api_..."
      }
    }
  }
}
```

For local development without a build step, point `command` at
`npx tsx /path/to/src/agent-iface/mcp/index.ts` instead.

### What the client sees

`createMcpServer()` (`src/agent-iface/mcp/server.ts`) registers one tool per
agent-facing command — `schedule_plan`, `hotspot_check`,
`hotspot_register`, `hotspot_acquire`, `hotspot_release`,
`hotspot_release_by_holder`, `hotspot_list_active`, `gate_run`,
`provenance_record`, `provenance_query`, `release_create`, `release_list`,
`release_manifest`, `release_notes` — each with an `inputSchema` generated
from the same zod shape the CLI validates against, so a client can
introspect the schema before calling rather than guessing the payload shape
from docs.

Because this transport is a long-running process, hotspot leases taken
through it persist for the life of that MCP session — this is the surface
to use when an agent runtime needs a lease to survive across multiple tool
calls (acquire in one turn, release in a later one). See
[Statefulness](./api.md#hotspots) in the API reference for the contrast with
the CLI.

## Driving harbormaster from a script or CI job

When the caller isn't itself an MCP client — a CI pipeline, a cron job, a
non-agent orchestration script — use the CLI directly. It's a single-shot
process: one command in, one JSON result out, exit code signals success.

```bash
npm run build   # or use `npm run cli --` in dev, via tsx
```

```bash
./dist/agent-iface/cli/index.js schedule plan '{
  "tickets": [
    { "ticketId": "ENG-1", "expectedFiles": ["src/release/branch.ts"] }
  ]
}'
```

Or installed as a bin after `npm install -g .` / `npm link` (see
`package.json`'s `bin.harbormaster`):

```bash
harbormaster gate run '{ "dispatchId": "d1", "ticketId": "ENG-1", "branch": "feat/ENG-1/x", "ciStatus": "success" }'
```

Because each invocation is a fresh process, treat the CLI as stateless
between calls — hotspot leases acquired via one CLI invocation are gone by
the next. Provenance and release commands are unaffected since they're
Postgres-backed, not in-process state.

From a Node-based CI job or orchestration script, `runCli(argv)`
(`src/agent-iface/cli/index.ts`) is the same dispatcher the `harbormaster`
bin uses, importable directly to skip the subprocess:

```typescript
import { runCli } from './src/agent-iface/cli'

await runCli(['gate', 'run', JSON.stringify({
  dispatchId: 'd1', ticketId: 'ENG-1', branch: 'feat/ENG-1/x', ciStatus: 'success',
})])
```

## End-to-end walkthrough

Standing up all three integrations together, from a ticket in Linear to a
released version, using the CLI for readability (any step below also works
as an MCP tool call):

```bash
# 0. One-time setup: createdb + run migrations (see Database section above),
#    then export config
export DATABASE_URL=postgresql://localhost:5432/harbormaster
export GITHUB_APP_ID=... GITHUB_APP_PRIVATE_KEY=... GITHUB_WEBHOOK_SECRET=...
export LINEAR_API_KEY=lin_api_...

# 1. Schedule two tickets pulled from Linear
harbormaster schedule plan '{
  "tickets": [
    { "ticketId": "ENG-1", "title": "Refactor release branch logic", "expectedFiles": ["src/release/branch.ts"] },
    { "ticketId": "ENG-2", "title": "Add hotfix support", "expectedFiles": ["src/release/hotfix.ts"] }
  ]
}'
# → both land in wave 0 (no file overlap) — dispatch both agents now

# 2. Agent for ENG-1 finishes, opens a PR; your integration code calls
#    GitHubMergeQueueAdapter.enqueue(prNumber, 'squash', 'disp-1') to submit
#    it to GitHub's merge queue (see GitHub integration above)

# 3. GitHub merge queue rebases and runs CI on the merged result; once green,
#    report that outcome through the gate
harbormaster gate run '{
  "dispatchId": "disp-1", "ticketId": "ENG-1", "branch": "feat/ENG-1/refactor",
  "domains": ["release"], "expectedFiles": ["src/release/branch.ts"], "actualFiles": ["src/release/branch.ts"],
  "ciStatus": "success", "qaResult": { "passed": true }
}'
# → passed: true — GitHub's merge queue completes the merge

# 4. Record it in the audit log
harbormaster provenance record '{
  "eventType": "merge.completed", "ticketId": "ENG-1", "agentId": "disp-1", "actor": "harbormaster-queue"
}'

# 5. Once both tickets are merged, cut a release and pull its manifest from Linear
harbormaster release create '{ "version": "1.2.0", "branch": "release/1.2.0" }'
harbormaster release manifest '{ "releaseId": "<id-from-step-5>", "teamId": "team-eng" }'
harbormaster release notes '{ "manifest": { ...output of the previous command... } }'
```

Steps 1, 3, 4, and 5 are pure CLI/MCP calls. Steps 0 and 2 are the external
wiring this guide exists to describe: standing up Postgres/GitHub/Linear,
and calling `GitHubMergeQueueAdapter` from whatever code observes your CI
result and submits the PR to the queue.
