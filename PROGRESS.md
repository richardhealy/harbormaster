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

- [x] `src/impact/types.ts` — `ImpactEstimateInput`, `ImpactSurface`, `DomainMap`, `DEFAULT_DOMAIN_MAP`
- [x] `src/impact/index.ts` — `ImpactEstimator` class
  - `estimate(input)`: from explicit `expectedFiles` (confidence 1.0), labels (0.6), or title/description keywords (0.3)
  - Derives directories and domains from file paths using a configurable keyword map
  - `jaccardSimilarity(a, b)`: set intersection / union for file/domain arrays
  - `computeOverlap(a, b)`: file-level Jaccard when concrete files are known; directory containment check; domain Jaccard as fallback
  - `deriveDirectories(files)`: extracts unique parent directories from file lists
- [x] `src/scheduler/types.ts` — `ScheduleDecision`, `ScheduledGroup`, `DispatchWave`, `DispatchPlan`, `SchedulerTicket`, `SchedulerConfig`, `DEFAULT_SCHEDULER_CONFIG`
- [x] `src/scheduler/index.ts` — `Scheduler` class
  - `plan(tickets, surfaces)`: produces a `DispatchPlan` with ordered waves
  - Union-find clustering: tickets with Jaccard ≥ mergeThreshold are merged into one job
  - Kahn's topological sort: groups with any overlap > sequenceThreshold land in later waves
  - `combinedSurface` on each group: union of all member tickets' impact surfaces
  - Decision labels: `parallel` (same wave, no overlap), `sequence` (later wave, some overlap), `merge` (one agent job)
- [x] 34 unit tests: 19 for impact, 15 for scheduler (all passing)
- [x] Total test count: 124

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
