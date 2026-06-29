# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Added — 2026-06-29
- M0 scaffold: TypeScript project setup (package.json, tsconfig, jest config, CI workflow)
- Postgres schema: tickets, dispatch_plans, audit_events, hotspot_leases, releases, gate_decisions
- `src/db/client.ts`: pg Pool singleton with `query`, `withTransaction`, `closePool`
- `src/release/`: ported release lifecycle — `SemverBumper`, `ReleaseBranchManager`, `HotfixManager`, `SyncManager`
- `src/integrations/github/`: GitHub App scaffold with webhook registration and protected-branch enforcement
- `src/integrations/linear/`: Linear GraphQL client with ticket and cycle queries
- Control-plane HTTP server (`src/app.ts`) with `/health` and `/webhooks/github` endpoints
- Stub modules for M1–M9 directories to establish the target architecture
- 25 tests covering the release lifecycle, db client, and GitHub App construction
