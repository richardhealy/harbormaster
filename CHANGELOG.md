# Changelog

All notable changes to this project are documented here.

## [Unreleased]

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
