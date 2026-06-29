# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Added — 2026-06-29
- M0 scaffold: TypeScript/Node.js project with full directory structure matching spec
- Postgres schema for tickets, dispatch plans, worktrees, gate events, hotspot leases, and releases
- Database client (`src/db/client.ts`) with connection pool and schema migration
- Release lifecycle (`src/release/`): semver bump, release branch creation, tag-main with idempotency guards, hotfix start/finish fan-out, sync-develop with conflict resolution — porting the `release.sh` concepts to typed TypeScript
- GitHub App integration skeleton (`src/integrations/github/`): App client factory, check-run upsert, direct-main-push enforcement policy
- Linear client skeleton (`src/integrations/linear/`): ticket fetch and status update
- Scheduler planner (`src/scheduler/`): overlap scoring and parallel/sequence/merge dispatch plan generation
- Impact estimator (`src/impact/`): heuristic path expansion, source file walker, import graph builder
- Gate policy engine (`src/gates/`): per-domain policies (default, migration, shared-contract, docs, tests), policy resolution, gate evaluation
- Provenance audit log (`src/provenance/`): append-only gate event recorder and audit trail reader
- Hotspot advisory leases (`src/hotspots/`): database-backed acquire/release with expiry and conflict detection
- Integration stubs: worktree creation/listing, merge queue adapter interface + no-op implementation, rerun orchestrator, semantic conflict check stub
- 45 unit tests covering semver, scheduler, gates, impact, and GitHub policy
- ESLint + Vitest configuration; all checks passing
