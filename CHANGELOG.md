# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Added — 2026-06-30

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
