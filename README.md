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

**Spec complete.** M0–M9 done — every milestone in `spec.md` is implemented and the full test suite passes. See [PROGRESS.md](./PROGRESS.md) for the milestone tracker. Documentation is in progress.

## Documentation

- [docs/api.md](./docs/api.md) — full reference for the agent-facing command surface (CLI + MCP), shared by both transports: request/response shapes, configuration, and error cases for all 14 commands.
- [docs/architecture.md](./docs/architecture.md) — component map, data/control-flow diagram, key design decisions and trade-offs, external dependencies, and where each part of the spec lives in the code.
- [docs/integration.md](./docs/integration.md) — standing up Postgres/GitHub/Linear, wiring the GitHub App and merge queue, and driving harbormaster from an agent runtime (MCP) or a script/CI job (CLI), with an end-to-end walkthrough.

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
    schemas.ts       # Zod schemas shared by both surfaces
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

## Integration layer

### Worktrees (`src/integration/worktrees/`)

`WorktreeManager` creates isolated git worktrees for each dispatch so agents never touch the same working tree:

```typescript
import { createWorktreeManager } from './src/integration/worktrees'
import { simpleGit } from 'simple-git'

const manager = createWorktreeManager(simpleGit('/repo'), '/repo')
const info = await manager.create({ dispatchId: 'disp-1', branch: 'feat/ENG-1/my-feature' })
// → { path: '/repo/.worktrees/disp-1', branch: 'feat/ENG-1/my-feature', ... }
await manager.remove('disp-1')
```

### Queue adapter (`src/integration/queue/`)

`GitHubMergeQueueAdapter` wraps GitHub's native merge queue. Enabling auto-merge on a PR submits it to the queue (requires merge-queue branch protection on the target branch):

```typescript
import { GitHubMergeQueueAdapter } from './src/integration/queue'

const queue = new GitHubMergeQueueAdapter(octokit, 'owner', 'repo')
await queue.enqueue(42, 'squash', 'disp-1')  // enables auto-merge → enters GitHub merge queue
await queue.listQueued()                       // lists all PRs with auto-merge enabled
queue.updateStatus(42, 'merged')              // called from merge_group webhook
```

## Scheduler (`src/impact/` + `src/scheduler/`)

The conflict-aware scheduler is the core of harbormaster. It takes a set of tickets with estimated impact surfaces and produces a dispatch plan that prevents most collisions before work begins.

### Impact estimation (`src/impact/`)

```typescript
import { ImpactEstimator } from './src/impact'

const estimator = new ImpactEstimator()

// From explicit file list (confidence 1.0)
const surface = estimator.estimate({
  ticketId: 'ENG-1',
  title: 'Refactor release branch logic',
  expectedFiles: ['src/release/branch.ts', 'src/release/tags.ts'],
})

// From labels/keywords (confidence 0.6 / 0.3)
const surface2 = estimator.estimate({
  ticketId: 'ENG-2',
  title: 'Add hotfix support',
  labels: ['release'],
})
```

### Scheduling (`src/scheduler/`)

```typescript
import { Scheduler } from './src/scheduler'

const scheduler = new Scheduler({ mergeThreshold: 0.5, sequenceThreshold: 0 })

const plan = scheduler.plan(
  [{ ticketId: 'ENG-1' }, { ticketId: 'ENG-2' }, { ticketId: 'ENG-3' }],
  new Map([
    ['ENG-1', surface1],
    ['ENG-2', surface2],
    ['ENG-3', surface3],
  ])
)

// plan.waves — ordered execution waves
// plan.waves[0] — runs in parallel (no overlap)
// plan.waves[1] — runs after wave 0 completes (overlapping groups)
// Merged groups (decision: 'merge') go to one agent as a single job
```

Decision rules (by Jaccard overlap score):
- `overlap >= mergeThreshold` → **merge**: dispatch both tickets to one agent as a single job
- `0 < overlap < mergeThreshold` → **sequence**: run one ticket after the other
- `overlap == 0` → **parallel**: safe to run at the same time

## Gate pipeline (`src/gates/`)

Every change passes through a configurable gate pipeline before merge. Stages run in order; the pipeline stops at the first failure.

| Stage | When it runs | What it checks |
|-------|-------------|----------------|
| **scope** | Always | Drift ratio: unexpected files / expected files. Passes if no files were predicted (low confidence). |
| **ci** | Always | Injectable `CICheckFn` — must return `'success'`. |
| **qa** | When `policy.requiresQA` | Injectable `QACheckFn` — eval score, automated checks, or sign-off. |
| **hitl** | When `policy.requiresHITL` | Injectable `ApprovalFn` — human reviewer must approve. |

### Domain risk levels

`resolvePolicy(domains)` picks the **strictest** policy across all input domains:

| Risk | Domains | Scope threshold | QA | HITL |
|------|---------|----------------|-----|------|
| **low** | `docs`, `readme` | 200% | — | — |
| **medium** (default) | `release`, `scheduler`, `integration/*`, `agent-iface`, `integrations/*` | 50% | ✓ | — |
| **high** | `db`, `hotspots`, `provenance` | 20% | ✓ | ✓ |

```typescript
import { createGatePipeline, resolvePolicy } from './src/gates'

const pipeline = createGatePipeline({
  checkCI: async branch => {
    // query GitHub check runs for this branch ref
    return 'success'
  },
  runQA: async (dispatchId, branch) => {
    // run automated eval or check sign-off
    return { passed: true }
  },
  approve: async (dispatchId, ticketId) => {
    // block until a human approves via Slack / GitHub review
    return true
  },
})

const result = await pipeline.run({
  dispatchId: 'disp-42',
  ticketId: 'ENG-42',
  branch: 'feat/ENG-42/add-feature',
  domains: ['release'],           // resolves to medium-risk policy
  expectedFiles: ['src/release/branch.ts'],
  actualFiles: ['src/release/branch.ts'],
})
// result.passed → true
// result.gates  → [{stage:'scope',status:'pass'}, {stage:'ci',status:'pass'}, {stage:'qa',status:'pass'}]
```

## Releases (`src/releases/`)

`ReleaseManager` assembles Linear-planned releases, generates manifests and notes, and enforces freeze windows:

```typescript
import { createReleaseManager } from './src/releases'

const manager = createReleaseManager(pool)

// Create a release record
const release = await manager.create('1.2.0', {
  branch: 'release/1.2.0',
  linearCycleId: 'cycle-abc',
})

// Pull tickets from Linear and build the manifest
const manifest = await manager.buildManifest(release.id, linearClient, 'team-eng', ['v1.2.0'])
// manifest.tickets — ManifestTicket[] with status, priority, labels, assignee
// manifest.summary — { total, byStatus, byPriority }

// Generate markdown release notes categorised by label
const notes = manager.generateNotes(manifest)
// ## Features  →  feat/feature-labelled tickets
// ## Fixes     →  bug/fix-labelled tickets
// ## Improvements → chore/enhancement-labelled tickets
// ## Other     →  everything else
await manager.saveNotes(release.id, notes)

// Freeze the release (no new merges)
await manager.setFreezeWindow(release.id, new Date('2024-07-01T12:00:00Z'))
const frozen = await manager.isInFreezeWindow(release.id)  // true after freeze_at

// Mark shipped
await manager.updateStatus(release.id, 'released')  // sets released_at = NOW()

// List all planning-stage releases
const planning = await manager.listReleases('planning')
```

## Agent interface (`src/agent-iface/`)

Agents drive the harbormaster loop through two thin surfaces over the same command layer (`src/agent-iface/commands.ts`): a single-shot CLI and a long-running MCP server. Neither surface contains any logic of its own — they validate input against the same zod schemas and call straight into `commands.ts`, so the two can never drift apart.

### CLI

Every subcommand takes a JSON payload, either as the last argument or piped via stdin with `--stdin`, and prints JSON to stdout:

```bash
npm run cli -- schedule plan '{
  "tickets": [
    { "ticketId": "ENG-1", "title": "Refactor release branch logic", "expectedFiles": ["src/release/branch.ts"] },
    { "ticketId": "ENG-2", "title": "Add hotfix support", "expectedFiles": ["src/release/hotfix.ts"] }
  ]
}'

npm run cli -- hotspot check '{"files":["src/db/migrations/002_x.sql"]}'
npm run cli -- gate run '{"dispatchId":"d1","ticketId":"ENG-1","branch":"feat/ENG-1/x","domains":["release"],"expectedFiles":["src/release/branch.ts"],"actualFiles":["src/release/branch.ts"],"ciStatus":"success"}'

npm run cli -- --help   # lists every command
```

Once built (`npm run build`), the compiled CLI is also installable as the `harbormaster` bin (see `package.json`).

### MCP server

```bash
npm run mcp   # starts the harbormaster MCP server on stdio
```

Registers one tool per command — `schedule_plan`, `hotspot_check`, `hotspot_register`, `hotspot_acquire`, `hotspot_release`, `hotspot_release_by_holder`, `hotspot_list_active`, `gate_run`, `provenance_record`, `provenance_query`, `release_create`, `release_list`, `release_manifest`, `release_notes` — each with a JSON Schema generated from the same zod definitions used by the CLI. Point any MCP-compatible client (Claude Code, Cursor, etc.) at `node dist/agent-iface/mcp/index.js` after `npm run build`.

### Statefulness

Hotspot leases live in an in-process manager. The MCP server is long-running, so leases persist for the life of that process — exactly the "advisory lock" semantics the spec calls for. The CLI is a fresh process per invocation, so leases taken through it do not persist across separate `harbormaster` runs; use the MCP server (or the library directly) when you need leases to outlive a single command. Provenance and release commands are backed by Postgres and persist regardless of which surface calls them.

## Releases milestone status

All milestones in `spec.md` (M0–M9) are implemented: scaffold, worktrees + queue, optimistic re-run, impact + scheduler, semantic conflict detection, hotspot leases, gates, Linear + provenance, Linear-planned releases, and the CLI/MCP agent interface above.
