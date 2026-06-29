# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Added — 2026-06-29
- M0 scaffold: Node/TypeScript project with full directory structure matching the spec architecture
- Postgres connection pool and transaction helper with schema migration runner (schema_migrations, audit_log, hotspot_leases, dispatch_plan, releases tables)
- GitHub App webhook handler: HMAC-SHA256 signature verification, push-to-main protection, check run creation
- Release lifecycle module: semver bump (major/minor/patch/prerelease), infer bump type from conventional commits, create-branch, tag-main with idempotency guards, hotfix-start/hotfix-finish with fan-out, sync-develop with package.json conflict auto-resolve, feature branch naming convention
- Scheduler: impact surface overlap computation (Jaccard), parallel/sequence/merge dispatch planning with configurable thresholds
- Gate pipeline: scope drift check, CI gate, QA gate, HITL approval, per-domain policy (docs/feature/migration/security risk tiers)
- Hotspot advisory leases: acquire/release/query active lease backed by Postgres
- Integration layer: git worktree create/remove/list/rebase helpers; GitHub merge queue adapter; cross-branch semantic conflict detection via tsc; automatic loser re-dispatch logic
- Impact module: diff-based impact surface estimation, dependency edge extraction from import statements
- Linear GraphQL client and webhook verification
- Provenance audit log: record events, query by ticket or release version
- MCP tool definitions for all agent-facing operations (dispatch, complete, status, release, leases)
- CLI agent request interface and dispatch plan formatter
- Express HTTP control-plane server with /health and webhook endpoints
- Full test suite: 67 tests across 8 suites covering semver, scheduler, gates, GitHub App, MCP tools, rerun logic, lifecycle, and server
- ESLint and TypeScript strict-mode configured; all checks pass
