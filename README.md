# harbormaster

A coordination layer for a fleet of AI coding agents on one repo. It schedules work so agents rarely collide, integrates optimistically through a merge queue so the rare collision is cheap, and runs the whole thing under ticketed, on-the-record release management.

**Stack:** Node 20 / TypeScript · Postgres · GitHub App · Linear

## The problem it solves

Running multiple autonomous coding agents on the same repo creates merge collisions. harbormaster prevents them at the source (scheduling), absorbs the ones that slip through (optimistic merge queue), and maintains a full audit trail of every dispatch and merge.

Three layers, in priority order:

1. **Conflict-aware scheduler** — estimates impact surface per ticket, runs non-overlapping tickets in parallel, sequences or merges overlapping ones. Most collisions never happen.
2. **Optimistic merge queue** — wraps GitHub merge queue / Mergify. Every agent works in its own worktree. Integration serializes: rebase, CI on the merged result, merge on green. A loser re-runs automatically.
3. **Advisory leases for hotspots** — migrations and shared contracts get a lock. The other 95% stays lock-free.

## Status

**Spec complete.** M0–M9 done — every milestone in `spec.md` is implemented and the full test suite (320 tests) passes. Most tests exercise the logic against mocked git/HTTP/DB clients; the headline scheduling guarantee (item 1 of the spec's quality checklist) is additionally proven against a real, throwaway git repository in `tests/e2e/headline-scheduling.e2e.test.ts`. See [PROGRESS.md](./PROGRESS.md) for the milestone tracker and the remaining real-git/real-subprocess proof gaps.

## Documentation

Start at [docs/README.md](./docs/README.md) for the full index and reading-order guidance. Quick links:

- [docs/how-to.md](./docs/how-to.md) — copy-pasteable recipes: run the scheduler demo, take a hotspot lease, run a gate, record provenance, cut a release, plus a troubleshooting table.
- [docs/api.md](./docs/api.md) — full reference for the agent-facing command surface (CLI + MCP), shared by both transports: request/response shapes, configuration, and error cases for all 14 commands.
- [docs/architecture.md](./docs/architecture.md) — component map, data/control-flow diagram, key design decisions and trade-offs, external dependencies, and where each part of the spec lives in the code.
- [docs/integration.md](./docs/integration.md) — how to stand the control plane up, drive it as an agent (CLI, MCP, or in-process), wire up GitHub and Linear, and a worked end-to-end flow.

## Project layout

```
src/
  impact/           # ImpactEstimator — file + domain overlap surfaces per ticket
  scheduler/        # Scheduler — conflict-aware dispatch plan (parallel/sequence/merge)
  gates/            # GatePipeline — scope / CI / QA / HITL with per-domain policy
  integration/
    worktrees/      # WorktreeManager — per-task git worktrees off the current tip
    queue/          # GitHubMergeQueueAdapter — adapter over GitHub merge queue
    rerun/          # Rebaser, CIChecker, Rerunner — optimistic re-dispatch loop
    semantic/       # SemanticConflictDetector — cross-branch tsc typecheck + conflict analysis
  hotspots/         # HotspotLeaseManager — advisory leases for declared un-mergeable paths
  release/          # ported release.sh lifecycle (semver, branches, tags, hotfix, sync)
  db/               # Postgres connection, migration runner, TypeScript schema types
    migrations/     # SQL migration files (applied in order)
  releases/         # ReleaseManager — Linear-planned releases, manifests, notes, freeze windows
  integrations/
    github/         # GitHub App (webhook registration, push enforcement)
    linear/         # Linear API client + TicketSyncer
  agent-iface/      # Agent-facing command surface shared by the CLI and MCP server
    commands.ts     # One function per operation: schedule, hotspot, gate, provenance, release
    schemas.ts      # Zod schemas shared by both surfaces
    cli/            # `harbormaster <command> <json-payload>` — single-shot JSON-in/JSON-out CLI
    mcp/            # MCP server — one tool per command, stdio transport
  config.ts         # Zod-validated config from environment
  index.ts          # Control-plane entry point
tests/
  gates/            # Unit tests for gate pipeline (37 tests)
  hotspots/         # Unit tests for hotspot leases (30 tests)
  impact/           # Unit tests for impact estimator (19 tests)
  releases/         # Unit tests for release manager (40 tests)
  scheduler/        # Unit tests for conflict-aware scheduler (15 tests)
  integration/      # Unit tests for worktrees (13), queue (15), rerun (27), semantic (21)
  release/          # Unit tests for the git release lifecycle module (35 tests)
  agent-iface/      # Unit tests for commands, CLI dispatch, and the MCP tool registry (26 tests)
.github/
  workflows/
    ci.yml          # Typecheck → lint → build → test on every push/PR
```

## Getting started

### Prerequisites

- Node 20+
- Postgres 14+

### Setup

```bash
npm install
cp .env.example .env
# edit .env with your DATABASE_URL, GitHub App credentials, etc.
```

### Development

```bash
npm run dev          # ts-node watch mode
npm test             # run tests
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run build        # compile to dist/
```

### Database

Run migrations before starting the service:

```typescript
import { getPool } from './src/db'
import { runMigrations } from './src/db/migrate'

await runMigrations(getPool(), './src/db/migrations')
```

### GitHub App

Set `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, and `GITHUB_WEBHOOK_SECRET` in your `.env`. Without these, the GitHub integration is disabled and the service still starts.

## Release lifecycle

The `src/release/` module is a TypeScript port of the `ggsa-spt/release.sh` workflow:

| Function | Description |
|----------|-------------|
| `autoNextRelease(git)` | Bumps the next minor version off the latest tag and creates `release/<version>` from main |
| `createReleaseBranch(git, version)` | Creates a `release/<version>` branch |
| `tagMain(git, version)` | Tags HEAD as `v<version>` with two idempotency guards (tag-exists, has_post_release_run) |
| `hotfixStart(git)` | Bumps the patch version and creates `hotfix/<version>` |
| `hotfixFinish(git, branch, targets)` | Merges the hotfix into main, develop, and any active release branches |
| `syncDevelop(git)` | Merges main into develop, auto-resolving the package.json version conflict |
| `featureBranchName({type, ticketId, description})` | Returns `feat/ENG-123/add-user-auth` style branch name |

## Modules at a glance

| Module | What it does |
|---|---|
| `src/impact/` + `src/scheduler/` | Estimates each ticket's impact surface and produces a dispatch plan — parallel/sequence/merge — so overlapping work rarely runs concurrently. |
| `src/integration/worktrees/` | Per-dispatch git worktrees off the current tip, so agents never share a working tree. |
| `src/integration/queue/` | Adapter over GitHub's native merge queue: enqueue via auto-merge, track status, dequeue. |
| `src/integration/rerun/` | Rebase, CI-on-result, and automatic re-dispatch for the losing side of a collision. |
| `src/integration/semantic/` | Cross-branch `tsc` typecheck to catch a signature change breaking a caller on another branch, before either merges. |
| `src/hotspots/` | Advisory leases for the small declared set of un-mergeable paths (migrations, shared contracts); everything else stays lock-free. |
| `src/gates/` | Scope / CI / QA / HITL pipeline, policy resolved per domain risk level. |
| `src/provenance/` | Immutable audit log — every dispatch, gate decision, and merge traces to a ticket and an actor. |
| `src/releases/` | Linear-planned releases: manifests, categorised release notes, freeze windows. |
| `src/agent-iface/` | The CLI and MCP server agents actually drive the loop through — one function per operation, shared zod schemas, no logic duplicated between the two surfaces. |

For runnable examples of every module above — the scheduler's parallel/sequence/merge decisions, taking a hotspot lease, running a gate, recording provenance, cutting a release — see **[docs/how-to.md](./docs/how-to.md)**. For exact request/response shapes, see **[docs/api.md](./docs/api.md)**. For how the modules connect end to end, see **[docs/architecture.md](./docs/architecture.md)**.

## Agent interface

Agents drive harbormaster through two thin surfaces over the same command layer (`src/agent-iface/commands.ts`): a single-shot CLI and a long-running MCP server. Neither surface has logic of its own — both validate against the same zod schemas and call straight into `commands.ts`.

```bash
npm run cli -- schedule plan '{"tickets": [...]}'
npm run cli -- --help          # lists every command

npm run mcp                    # starts the MCP server on stdio
```

Once built (`npm run build`), the compiled CLI is also installable as the `harbormaster` bin, and the MCP server is runnable directly at `dist/agent-iface/mcp/index.js` for any MCP-compatible client (Claude Code, Cursor, etc.).

Hotspot leases live in an in-process manager: they persist for the life of the MCP server, but not across separate CLI invocations (each is a fresh process). Provenance and release commands are backed by Postgres and persist regardless of which surface calls them. See [docs/integration.md](./docs/integration.md) for the full breakdown and [docs/how-to.md](./docs/how-to.md) for a worked example of the persistence gotcha.

## Where to go next

- Running a specific command → [docs/how-to.md](./docs/how-to.md)
- Exact field-level API reference → [docs/api.md](./docs/api.md)
- How the system fits together → [docs/architecture.md](./docs/architecture.md)
- Standing it up against real GitHub/Linear → [docs/integration.md](./docs/integration.md)
- Milestone-by-milestone build history → [PROGRESS.md](./PROGRESS.md) and [CHANGELOG.md](./CHANGELOG.md)
