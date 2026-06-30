# PROGRESS

## Implementation

| # | Milestone | Status |
|---|-----------|--------|
| M0 | Scaffold: control-plane, Postgres, GitHub App, release/, CI | ☑ Done |
| M1 | Worktrees + queue | ☑ Done |
| M2 | Optimistic re-run | ☐ Not started |
| M3 | Impact + scheduler | ☐ Not started |
| M4 | Semantic conflicts | ☐ Not started |
| M5 | Hotspot leases | ☐ Not started |
| M6 | Gates | ☐ Not started |
| M7 | Linear + provenance | ☐ Not started |
| M8 | Releases | ☐ Not started |
| M9 | Agent interface | ☐ Not started |

### M0 — Scaffold (done)

- [x] Node 20 / TypeScript 5 project (package.json, tsconfig.json, tsconfig.build.json)
- [x] Directory layout matching spec: release/, db/, integrations/github/, integrations/linear/
- [x] Postgres schema + migration runner (`src/db/migrations/001_initial.sql`, `src/db/migrate.ts`)
  - audit_log, tickets, dispatches, gate_decisions, releases tables
- [x] GitHub App skeleton (`src/integrations/github/`)
  - App init via `@octokit/app`, webhook handlers (push, pull_request, check_suite)
- [x] Linear client stub (`src/integrations/linear/`)
- [x] Release lifecycle port from `release.sh` (`src/release/`)
  - [x] Semver bump from latest tag (`semver.ts`)
  - [x] `createReleaseBranch`, `autoNextRelease` (`branch.ts`)
  - [x] `tagMain` with tag-exists and has_post_release_run idempotency guards (`tags.ts`)
  - [x] `hotfixStart` / `hotfixFinish` with fan-out (`hotfix.ts`)
  - [x] `syncDevelop` with package.json conflict auto-resolve (`sync.ts`)
  - [x] Feature branch naming convention: `<type>/<ticketId>/<slug>` (`branch.ts`)
- [x] 35 unit tests across release module (all passing)
- [x] CI configuration (`.github/workflows/ci.yml`)
- [x] ESLint 9 flat config
- [x] `PROGRESS.md`, `README.md`, `CHANGELOG.md`

### M1 — Worktrees + queue (done)

- [x] `src/integration/worktrees/` — `WorktreeManager` class
  - `create(options)`: `git worktree add -b <branch> <path> <base>`, returns `WorktreeInfo`
  - `remove(dispatchId)`: `git worktree remove --force <path>`
  - `prune()`: `git worktree prune`
  - `list()`: parses `git worktree list --porcelain`, filters to managed base
  - `parseWorktreeList()` exported for unit testing
  - `createWorktreeManager(git, repoRoot, worktreeBase?)` factory
- [x] `src/integration/queue/` — `GitHubMergeQueueAdapter` + `QueueAdapter` interface
  - `enqueue(prNumber, mergeMethod, dispatchId?)`: enables auto-merge via GraphQL (`enablePullRequestAutoMerge`)
  - `dequeue(prNumber)`: disables auto-merge via GraphQL
  - `getStatus(prNumber)`: returns local entry or falls back to GitHub REST
  - `listQueued()`: lists open PRs with `auto_merge` enabled
  - `updateStatus(prNumber, status)`: webhook-driven status updates
  - `OctokitLike` interface keeps the adapter testable without real GitHub credentials
- [x] 28 unit tests across both modules (13 worktrees + 15 queue), all passing
- [x] Total: 63 tests passing

## Documentation

*(Not yet started — will be seeded once the spec is fully implemented)*
