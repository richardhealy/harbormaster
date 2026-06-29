# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Added — 2026-06-29
- M0 scaffold: TypeScript project with strict tsconfig, Vitest test suite, ESLint
- Postgres schema for tickets, dispatch plans, gate results, audit log, releases, and hotspot leases
- DB client with pool management and transaction helpers (`src/db/`)
- Release lifecycle module porting `release.sh`: `createBranch`, `tagMain`, `hotfixStart`, `hotfixFinish`, `syncDevelop`, `autoNextRelease` with idempotency guards (`src/release/`)
- Semver utilities: parse, format, bump, compare, validate (`src/release/semver.ts`)
- GitHub App boilerplate: app factory, webhook handler registration (`src/integrations/github/`)
- Linear client stub: ticket fetch, status update, release fetch (`src/integrations/linear/`)
- Scheduler: `planDispatch` — overlap detection producing parallel/sequential dispatch plans (`src/scheduler/`)
- Hotspot registry: advisory lease acquire/release with expiry eviction (`src/hotspots/`)
- Gate pipeline: per-risk-level policy, stage evaluation, `isGreenForMerge` (`src/gates/`)
- Provenance log: in-memory audit entry recording with ticket/agent association (`src/provenance/`)
- 41 tests covering semver, scheduler, hotspots, gates, and provenance
