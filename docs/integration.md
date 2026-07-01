# Integration guide

This is the "stand it up and call it from somewhere else" guide. For the
full request/response contract of every agent-facing command, see
[docs/api.md](./api.md); for how the pieces fit together internally, see
[docs/architecture.md](./architecture.md). This guide covers the four ways
something outside the process talks to harbormaster:

1. [Running the control plane](#1-running-the-control-plane) — Postgres, migrations, config.
2. [Driving it as an agent](#2-driving-it-as-an-agent-cli--mcp) — CLI and MCP, the surface agents use.
3. [GitHub integration](#3-github-integration) — the App, webhooks, and the merge queue adapter.
4. [Linear integration](#4-linear-integration) — ticket sync and release planning.

It closes with a [worked end-to-end flow](#5-end-to-end-a-ticket-through-the-system)
that chains all four.

## 1. Running the control plane

### Prerequisites

- Node 20+
- Postgres 14+ (a local instance, or the `docker run` one-liner below)

```bash
docker run -d --name harbormaster-pg -p 5432:5432 \
  -e POSTGRES_USER=harbormaster -e POSTGRES_PASSWORD=harbormaster \
  -e POSTGRES_DB=harbormaster postgres:16
```

### Configure

```bash
npm install
cp .env.example .env
```

All configuration is environment variables, validated by `loadConfig()`
(`src/config.ts`) on first use — nothing is read until a command that needs
it runs, so the process boots even with an incomplete `.env`:

| Variable | Required | Effect if unset |
|---|---|---|
| `DATABASE_URL` | no (defaults to `postgresql://localhost:5432/harbormaster`) | commands that touch Postgres fail when they run |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET` | no, but all three or none | `createGitHubApp()` returns `null` — GitHub integration disabled, everything else still works |
| `LINEAR_API_KEY` | no | Linear commands fail when invoked; used to construct `LinearClient` |
| `PORT` | no (default `3000`) | only used by the log line in `src/index.ts` today — see [§3](#3-github-integration) for wiring an actual HTTP receiver |
| `NODE_ENV` | no (default `development`) | — |

### Apply migrations and boot

```typescript
import { getPool } from './src/db'
import { runMigrations } from './src/db/migrate'

await runMigrations(getPool(), './src/db/migrations')
```

`runMigrations` is idempotent (tracked in a `schema_migrations` table), so
run it on every deploy rather than gating it behind a first-run check.

```bash
npm run build && npm start     # or: npm run dev  (tsx watch, no build step)
```

`src/index.ts` loads config, checks DB connectivity, and initializes the
GitHub App if credentials are present — logging warnings rather than
exiting when either is unavailable, so the agent-iface commands that don't
need them (scheduler, hotspots, gates run in report-only mode) keep working
even with an incomplete environment.

## 2. Driving it as an agent (CLI + MCP)

This is the surface a coding agent actually calls. Both transports wrap the
same functions (`src/agent-iface/commands.ts`) and validate against the
same zod schemas, so pick whichever fits your agent runtime — see
[docs/api.md](./api.md) for the full command list and payload shapes.

### CLI — spawn per call

Good for agents that shell out (Claude Code's `Bash` tool, a CI step, a
one-off script):

```bash
npm run build
./dist/agent-iface/cli/index.js schedule plan '{
  "tickets": [
    { "ticketId": "ENG-1", "title": "Refactor release branch logic", "expectedFiles": ["src/release/branch.ts"] },
    { "ticketId": "ENG-2", "title": "Add hotfix support", "expectedFiles": ["src/release/hotfix.ts"] }
  ]
}'
```

Or without a build step, during development:

```bash
npm run cli -- schedule plan --stdin <<< '{"tickets": [...]}'
```

Exit code `0` + JSON on stdout means success; exit code `1` + a one-line
message on stderr means failure (validation or runtime).

Live example — `schedule plan` producing a two-ticket dispatch plan:

![harbormaster schedule plan output](./images/cli-schedule-plan.png)

### MCP — long-running subprocess

Good for an agent runtime that speaks MCP natively. Point it at
`npm run mcp` (dev) or `node dist/agent-iface/mcp/index.js` (built) as a
stdio server. For Claude Code / Cursor-style config:

```json
{
  "mcpServers": {
    "harbormaster": {
      "command": "node",
      "args": ["/absolute/path/to/harbormaster/dist/agent-iface/mcp/index.js"],
      "env": {
        "DATABASE_URL": "postgresql://harbormaster:harbormaster@localhost:5432/harbormaster",
        "LINEAR_API_KEY": "lin_api_..."
      }
    }
  }
}
```

Once connected, the client sees one tool per command, named with
underscores (`schedule_plan`, `hotspot_check`, `gate_run`, `release_create`,
etc. — the CLI form of the same commands is two space-separated words,
e.g. `schedule plan`), each with an
`inputSchema` generated from the same zod shape the CLI validates against —
introspectable, so the client can validate before calling rather than
round-tripping on error.

The MCP process is the one place harbormaster keeps in-memory state
(`getHotspotManager()` — see `src/agent-iface/commands.ts`): leases persist
across tool calls within one session because the process stays up between
them, unlike the CLI which starts fresh every invocation. If you need
leases to survive an MCP server restart, persist them yourself via
`provenance_record` and replay on boot; this isn't done automatically.

### Calling commands directly (embedding, no subprocess)

If your orchestrator is also Node/TypeScript, skip both transports and call
`src/agent-iface/commands.ts` in-process — it's the same code the CLI and
MCP server call:

```typescript
import { planSchedule, runGatePipeline } from './src/agent-iface/commands'

const plan = await planSchedule({ tickets: [...] })
const gate = await runGatePipeline({
  domains: ['release'],
  expectedFiles: ['src/release/branch.ts'],
  actualFiles: ['src/release/branch.ts'],
  ciStatus: 'success',
})
```

## 3. GitHub integration

### Create the App

1. GitHub → Settings → Developer settings → GitHub Apps → New GitHub App.
2. Permissions: **Contents** (read/write, for the queue adapter's PR/branch
   operations), **Pull requests** (read/write), **Checks** (read, for
   `CIChecker`).
3. Permissions also need **Administration** (read/write), so the App can
   configure branch protection on repos it's installed on.
4. Subscribe to events: `push`, `pull_request`, `check_suite`, `installation`,
   `installation_repositories` (matches the handlers in
   `src/integrations/github/webhooks.ts`; add `merge_group` if you also
   want queue-entry/exit events).
5. Set the webhook URL to `https://<host>:<PORT>/webhooks/github` (where
   `src/index.ts` mounts the receiver, see below), generate a webhook
   secret, generate a private key, and install the app on the target repo.
6. Set `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (the full PEM, newlines
   escaped as `\n` if passed via a single-line env var), and
   `GITHUB_WEBHOOK_SECRET`. Optionally set `GITHUB_PROTECTED_BRANCH`
   (defaults to `main`) and `GITHUB_REQUIRED_STATUS_CHECKS` (a comma-separated
   list of required check contexts, e.g. `ci,lint`; defaults to none).

### The webhook receiver and branch protection enforcement

`src/index.ts` wires the whole path when GitHub credentials are configured:
`createGitHubApp()` builds the `@octokit/app` client,
`registerWebhooks(app, options)` attaches the handlers, and
`startWebhookServer(app, config.PORT)` (`src/integrations/github/server.ts`)
mounts `@octokit/webhooks`'s Node middleware on `/webhooks/github` behind a
real HTTP server listening on `PORT` — GitHub's deliveries now actually
reach the process instead of being registered on a listener nothing feeds.

Enforcing "no direct main pushes and required checks" happens once,
automatically, whenever the App gains access to a repo: the
`installation.created` and `installation_repositories.added` handlers call
`enforceBranchProtection` (`src/integrations/github/branch-protection.ts`),
which sets branch protection on `GITHUB_PROTECTED_BRANCH` via the GitHub
API — required status checks from `GITHUB_REQUIRED_STATUS_CHECKS`, required
PR review, and `enforce_admins`. GitHub itself then refuses direct pushes
and merges without the named checks; the `push` handler's log line is an
observability signal for a push that already happened, not the enforcement
mechanism. If the App lacks the Administration permission the protection
call fails and is logged as a warning rather than crashing the process.

### The merge queue adapter

`GitHubMergeQueueAdapter` (`src/integration/queue/`) is what the rerun loop
and dispatch flow actually call — it wraps GitHub's native merge queue via
an injected Octokit instance:

```typescript
import { App } from '@octokit/app'
import { GitHubMergeQueueAdapter } from './src/integration/queue'

const app = createGitHubApp()!
const octokit = await app.getInstallationOctokit(installationId)
const queue = new GitHubMergeQueueAdapter(octokit, 'owner', 'repo')

await queue.enqueue(42, 'squash', dispatchId)   // enables auto-merge -> PR enters the merge queue
queue.updateStatus(42, 'merged')                // called from your merge_group webhook handler
```

This requires the target branch to have GitHub's merge queue enabled in
branch protection (Settings → Branches → merge queue) — the adapter doesn't
create that configuration, only drives PRs through it.

## 4. Linear integration

### Get an API key

Linear → Settings → API → Personal API keys (or a workspace bot token for
production). Set `LINEAR_API_KEY`.

### Sync tickets into Postgres

`TicketSyncer` (`src/integrations/linear/sync.ts`) pulls a team's issues and
upserts them into the `tickets` table, which is what the scheduler,
provenance, and release manifest all read from:

```typescript
import { LinearClient } from './src/integrations/linear'
import { TicketSyncer } from './src/integrations/linear/sync'
import { getPool } from './src/db'
import { loadConfig } from './src/config'

const { LINEAR_API_KEY } = loadConfig()
const linear = new LinearClient(LINEAR_API_KEY!)
const syncer = new TicketSyncer(getPool())

const { synced, errors } = await syncer.syncTeamTickets('team-uuid')
```

Run this on a schedule (cron, a Linear webhook receiver, or before each
scheduling pass) — nothing in harbormaster triggers it automatically today.

### Release notes and manifests

`ReleaseManager.buildManifest()` (`src/releases/index.ts`) calls back into
the same `LinearClient` to pull ticket details for a manifest; see
[docs/api.md](./api.md#release_manifest) for the CLI (`release manifest`) /
MCP (`release_manifest`) form, or call it directly:

```typescript
import { createReleaseManager } from './src/releases'

const releases = createReleaseManager(getPool())
const release = await releases.create('1.4.0', { branch: 'release/1.4.0' })
const manifest = await releases.buildManifest(release.id, linear, 'team-uuid')
const notes = releases.generateNotes(manifest)
```

## 5. End-to-end: a ticket through the system

Chaining everything above, using the agent-iface commands an agent would
actually call (CLI shown; MCP tool calls are the same payloads):

```bash
# 1. Sync Linear tickets (§4), then ask the scheduler for a dispatch plan
harbormaster schedule plan '{
  "tickets": [
    { "ticketId": "ENG-1", "title": "Fix branch naming", "expectedFiles": ["src/release/branch.ts"] },
    { "ticketId": "ENG-2", "title": "Add freeze window", "expectedFiles": ["src/releases/index.ts"] }
  ]
}'
# -> waves: ENG-1 and ENG-2 run in parallel (no file overlap)

# 2. Agent works in its worktree, opens a PR, harbormaster enqueues it
#    (GitHubMergeQueueAdapter.enqueue, §3) — the queue rebases and runs CI.

# 3. On green CI, run the gate pipeline before merge
harbormaster gate run '{
  "dispatchId": "disp-1",
  "ticketId": "ENG-1",
  "branch": "feat/ENG-1/fix-branch-naming",
  "domains": ["release"],
  "expectedFiles": ["src/release/branch.ts"],
  "actualFiles": ["src/release/branch.ts"],
  "ciStatus": "success"
}'
# -> release domain requires QA, not HITL (see docs/api.md's policy table);
#    pass qaResult to clear it, or the pipeline stops at the QA stage.

# 4. Record the merge on the audit trail
harbormaster provenance record '{
  "eventType": "merge.completed",
  "ticketId": "ENG-1",
  "agentId": "agent-7",
  "actor": "agent-7",
  "payload": { "prNumber": 42, "sha": "abc123" }
}'

# 5. When enough tickets have landed, cut a release
harbormaster release create '{ "version": "1.4.0", "branch": "release/1.4.0" }'
harbormaster release manifest '{ "releaseId": "<id-from-step-5>", "teamId": "team-uuid" }'
```

If a rebase or CI run in step 2 fails, `Rerunner.handleFailure`
(`src/integration/rerun/`) tears down the losing worktree, dequeues the PR,
and re-dispatches against the new tip automatically — no step here changes;
the agent just gets a fresh worktree and retries.
