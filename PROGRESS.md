# PROGRESS

## Implementation

| # | Milestone | Status |
|---|-----------|--------|
| M0 | Scaffold: control-plane, Postgres, GitHub App, release/, CI | ☑ Done |
| M1 | Worktrees + queue | ☑ Done |
| M2 | Optimistic re-run | ☑ Done |
| M3 | Impact + scheduler | ☑ Done |
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

### M2 — Optimistic re-run (done)

- [x] `src/integration/rerun/rebase.ts` — `Rebaser` class
  - `rebase(worktreePath, newBase)`: runs `git rebase <newBase>` in the worktree via a per-directory `GitFactory`
  - On success: returns `{ outcome: 'success', headSha }`
  - On conflict: collects unmerged files via `diff --name-only --diff-filter=U`, aborts, returns `{ outcome: 'conflict', conflictFiles }`
  - On unexpected error: aborts the rebase and returns `{ outcome: 'error', error }`
- [x] `src/integration/rerun/ci.ts` — `CIChecker` class
  - `checkStatus(ref)`: queries `GET /repos/{owner}/{repo}/commits/{ref}/check-runs`
  - Aggregates to `'success' | 'failure' | 'pending' | 'unknown'`
  - `neutral` and `skipped` conclusions treated as passing; `timed_out`, `cancelled`, `action_required` as failure
- [x] `src/integration/rerun/index.ts` — `Rerunner` class
  - `shouldRetry(attempt, maxAttempts?)`: guard against infinite retry loops
  - `cleanup(dispatchId, prNumber?)`: removes worktree and dequeues PR; errors swallowed
  - `currentTip(branch)`: resolves HEAD SHA of a branch in the main repo
  - `handleFailure(options, redispatch)`: full orchestration — cleanup → get new tip → call redispatch callback → create new worktree; returns `{ exhausted: true }` on limit
- [x] `src/integration/rerun/types.ts` — `RebaseResult`, `CIResult`, `RerunOptions`, `RerunResult`, `RedispatchFn` types
- [x] 27 unit tests; total test count 90

### M3 — Impact + scheduler (done)

- [x] `src/impact/types.ts` — `ImpactSurface`, `DependencyNode`, `DependencyGraph`, `OverlapAnalysis` types
- [x] `src/impact/graph.ts` — `buildDependencyGraph`: walks a source tree and builds a file-level dependency graph (import + importedBy edges); `extractImports`: extracts local imports via `from '...'`, bare `import '...'`, and `require('...')` patterns; `collectFiles` + `resolveImport` helpers
- [x] `src/impact/estimator.ts` — `computeTransitiveImpact`: BFS on the `importedBy` direction to find every file upstream of a ticket's direct changes; `analyseOverlap`: computes shared-file count and overlap ratio (against the smaller surface) between two impact surfaces
- [x] `src/scheduler/types.ts` — `TicketWithImpact`, `GroupDecision` (`'parallel' | 'merge'`), `DispatchGroup`, `DispatchStage`, `DispatchPlan`, `SchedulerConfig`
- [x] `src/scheduler/planner.ts` — `Scheduler` class: Union-Find merges high-overlap tickets, Kahn's topological sort assigns tickets to execution stages, non-overlapping tickets run in parallel within a stage, sequenced tickets appear in later stages
- [x] 53 new tests (15 estimator + 18 graph + 20 scheduler); total 143 passing
- [x] Headline test: two tickets sharing ≥ 1 file are placed in separate stages (or merged into one job if overlap > 70%) — never dispatched concurrently

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
