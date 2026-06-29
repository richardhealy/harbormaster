# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Added — 2026-06-29
- M0 scaffold: TypeScript/Node project with strict type checking, Jest test suite, and ESLint
- PostgreSQL schema: audit_log, releases, hotspot_leases, dispatches, gate_decisions tables with migration runner
- Release lifecycle ported from release.sh: semver bump (patch/minor/major with conventional-commit inference), release branch creation (idempotent), tag-main with idempotency guards, hotfix-start/finish with fan-out to main/develop/active release branches, sync-develop with package.json conflict auto-resolution
- GitHub App webhook infrastructure: HMAC-SHA256 signature verification middleware, event dispatcher, enforceNoDirectMainPush handler
- GitHub API client factory (installation-authenticated via Octokit)
- Express control-plane server with /health endpoint and /webhooks/github route
- GitHub Actions CI pipeline: typecheck → lint → build → test
- 39 unit tests covering all release module functions and webhook handlers
