# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Added — 2026-06-29
- M0 scaffold: Node/TypeScript project with `package.json`, `tsconfig.json`, ESLint, Jest
- Postgres schema migration (releases, tickets, dispatches, leases, gate_decisions, audit_log)
- Database pool module (`src/db/`) with typed query helper
- GitHub App integration skeleton (`src/integrations/github/`) with webhook handlers
- Release lifecycle module (`src/release/`): semver bump, `createRelease`, `autoNextRelease`, `tagMain` with idempotency guards, `hotfixStart`/`hotfixFinish` with fan-out to all active branches, `syncDevelop` with package.json conflict resolution, `createFeatureBranch` with conventional-commit naming
- Express control-plane server with `/health` endpoint
- 34-test suite covering semver helpers and the full release lifecycle (all green)
