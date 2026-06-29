# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Added — 2026-06-29
- M0 scaffold: TypeScript/Node project setup with Fastify HTTP server
- Postgres schema: releases, tickets, dispatch_plans, hotspot_leases, gate_decisions, audit_log
- GitHub App webhook handler with HMAC-SHA256 signature verification
- `src/release/` module porting the `release.sh` lifecycle into TypeScript:
  - Semver bumping (patch/minor/major) with idempotency helpers
  - Release and hotfix branch naming and planning
  - Tag planning with idempotency guards (tag-exists, has-post-release-run)
  - Hotfix fan-out planner (main + develop + active release branches)
  - sync-develop with package.json auto-resolve strategy
- Vitest test suite covering the full release module and GitHub webhook handler
- CI workflow (GitHub Actions) with Postgres service container
