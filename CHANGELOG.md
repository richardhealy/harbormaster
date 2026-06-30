# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Added — 2026-06-30 (M6)

- M6 gate pipeline: `GatePipeline` (`src/gates/`) evaluates changes through four sequential stages — scope drift, CI, QA, and HITL — using per-domain policy; `checkScope` computes `driftRatio = unexpectedFiles / totalActual` against a configurable threshold; `requireHITL: true` domains (db, release, hotspots) always stop for human approval while `docs` and medium-risk domains auto-merge on green CI; each stage returns a `GateDecision` record (outcome, reason, timestamp, approver) and the pipeline's `GateResult` indicates `canMerge` and `blockedAt`; all function dependencies (CI status, QA checks, HITL resolver) are injectable for deterministic testing; `createGatePipeline` ships five built-in domain policies
- 39 new unit tests; total test count 214

### Added — 2026-06-30 (M5)

- M5 hotspot leases: `HotspotLeaseManager` (`src/hotspots/`) enforces advisory leases on declared hotspots — files or directories that are too costly to re-work after a collision (database migrations, shared API contracts, etc.); `register` declares a hotspot with glob patterns and a reason; `check` detects overlaps without acquiring a lock; `acquire` grants the lease when free, returns `'blocked'` with the holder's lease when taken, or `'not-required'` when the files touch no hotspot; `release` and `releaseByHolder` free leases; `listActive` / `pruneExpired` manage TTL-based expiry; `matchesPattern` supports exact, directory-prefix (`/`), single-segment (`*`), and cross-segment (`**`) glob patterns; the rest of the repo remains entirely lock-free
- 30 new unit tests; total test count 175

### Added — 2026-06-30 (M4)

- M4 semantic conflict detection: `SemanticConflictDetector` (`src/integration/semantic/`) runs `tsc --noEmit` in each in-flight branch's worktree via an injectable `ExecFn`; `parseTscOutput` converts raw tsc stdout into structured `TypeScriptError` objects; `detect` checks branches in parallel and calls `checkPairConflict` for every pair — flagging conflicts when branch A has type errors in files that branch B modified, when B has errors in A's files, or when both error in the same file; reports a `SemanticConflictReport` with per-branch results, `CrossBranchConflict` entries (with deduplicated `filesInvolved` and a human-readable description), and a top-level `hasConflicts` flag
- 21 new unit tests covering parser edge cases, branch-level checks, and all cross-conflict detection scenarios; total test count 145

### Added — 2026-06-30 (M3)

- M3 impact + scheduler: `ImpactEstimator` (`src/impact/`) estimates a ticket's file/directory/domain impact surface from explicit file lists (confidence 1.0), label mappings (0.6), or title/description keywords (0.3); `jaccardSimilarity` and `computeOverlap` measure surface overlap (file Jaccard → directory containment → domain Jaccard)
- `Scheduler` (`src/scheduler/`) takes tickets + impact surfaces and produces a `DispatchPlan`: union-find clusters tickets with Jaccard ≥ mergeThreshold into merged jobs, Kahn's topological sort places overlapping groups in later waves, and non-overlapping groups share the same wave; decision labels are `parallel`, `sequence`, or `merge`
- 34 new unit tests (19 impact + 15 scheduler); total test count 124

### Added — 2026-06-30 (M2)

- M2 optimistic re-run: `Rebaser` (`src/integration/rerun/rebase.ts`) rebases a worktree branch onto a new tip via a per-directory `GitFactory`; on conflict it collects unmerged files via `git diff --name-only --diff-filter=U` and aborts to restore a clean state; on success it returns the new HEAD SHA
- `CIChecker` (`src/integration/rerun/ci.ts`) queries GitHub check runs for a ref and aggregates to `success | failure | pending | unknown`; neutral/skipped conclusions pass, timed_out/cancelled/action_required fail
- `Rerunner` (`src/integration/rerun/index.ts`) orchestrates the re-dispatch loop: guards with `shouldRetry`, tears down the failing worktree via `cleanup`, resolves the current tip of the base branch, calls a `RedispatchFn` callback for new identifiers, then creates a fresh worktree ready for the agent to re-run; returns `{ exhausted: true }` when the attempt limit is reached
- 27 new unit tests (8 file test total, 90 tests total)

### Added — 2026-06-30 (M1)

- M1 worktrees + queue: `WorktreeManager` (`src/integration/worktrees/`) creates isolated git worktrees per dispatch using `git worktree add -b`, with `remove`, `prune`, and `list` (parsing `--porcelain` output); factory `createWorktreeManager` provides a default `.worktrees/` base
- `GitHubMergeQueueAdapter` (`src/integration/queue/`) wraps GitHub's native merge queue: `enqueue` enables auto-merge via `enablePullRequestAutoMerge` (GraphQL), `dequeue` disables it, `getStatus` checks local state before falling back to REST, `listQueued` filters open PRs by `auto_merge`, and `updateStatus` handles webhook-driven transitions; `QueueAdapter` interface makes the adapter swappable
- 28 new unit tests (13 worktrees + 15 queue); total test count 63

### Added — 2026-06-29

- M0 scaffold: Node 20 / TypeScript 5 project with `tsconfig.json`, `tsconfig.build.json`, ESLint 9 flat config, and Vitest test runner
- Postgres schema (`src/db/migrations/001_initial.sql`): `audit_log`, `tickets`, `dispatches`, `gate_decisions`, `releases` tables; migration runner at `src/db/migrate.ts`
- GitHub App skeleton (`src/integrations/github/`): app initialisation via `@octokit/app`, webhook handlers for push (direct-main enforcement), pull_request.closed, and check_suite.completed
- Linear API client stub (`src/integrations/linear/`) for the M7 milestone
- Release lifecycle port from `release.sh` (`src/release/`): semver bump from latest tag, `createReleaseBranch`, `autoNextRelease`, `tagMain` with tag-exists and has_post_release_run idempotency guards, `hotfixStart`/`hotfixFinish` with fan-out to main/develop/release branches, `syncDevelop` with package.json conflict auto-resolve, and feature branch naming convention (`<type>/<ticketId>/<slug>`)
- 35 unit tests covering the full release module (all green)
- GitHub Actions CI workflow: typecheck → lint → build → test with Postgres service container
