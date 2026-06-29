# harbormaster

A coordination layer for a fleet of AI coding agents on a shared repository.

**Problem:** Multiple autonomous agents (Claude Code, Cursor, conductor) working the same repo collide. Locks are the wrong fix — they block cheap workers to avoid cheap losses, and they never catch semantic conflicts.

**Solution:** Three layers, in order of importance:
1. **Schedule against impact** — estimate each ticket's impact surface from the dependency graph and run non-overlapping tickets in parallel; sequence the ones that overlap; merge tickets that clearly hit the same code into one job. Most collisions never happen.
2. **Optimistic merge queue** — agents work in isolated worktrees; integration serializes (rebase → CI on merged result → merge); a collision shows up as a failed rebase or red CI and the loser re-runs automatically.
3. **Advisory leases for hotspots only** — migrations, shared contracts, and other genuinely un-mergeable spots get a lease. The rest of the repo stays lock-free.

## Stack

Node / TypeScript · PostgreSQL · GitHub App · Linear

## Status

**M0 complete:** TypeScript project scaffold, PostgreSQL schema, GitHub App webhook infrastructure, and the full release lifecycle ported from `release.sh` (semver bump, release branches, tagging with idempotency guards, hotfix fan-out, sync-develop).

See [PROGRESS.md](./PROGRESS.md) for the full milestone checklist.

## Quick start

```bash
# Install
npm install

# Configure
cp .env.example .env   # fill in DATABASE_URL, GITHUB_APP_ID, etc.

# Migrate database
npm run migrate

# Run the control plane
npm run dev

# Tests
npm test
```

## Architecture

```
src/
  release/          # ported release.sh lifecycle: semver, branches, tags, hotfix
  integrations/
    github/         # GitHub App webhook handler + API client
  db/               # Postgres connection pool + migration runner
  config.ts         # environment-based configuration
  server.ts         # Express server wiring
  index.ts          # entry point

migrations/         # SQL migration files (run with npm run migrate)
tests/              # Jest test suites (mirror of src/)
.github/workflows/  # CI pipeline (typecheck → lint → build → test)
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://localhost:5432/harbormaster` | Postgres connection string |
| `GITHUB_APP_ID` | — | GitHub App ID |
| `GITHUB_PRIVATE_KEY` | — | GitHub App private key (PEM) |
| `GITHUB_WEBHOOK_SECRET` | — | Webhook HMAC secret |
| `GITHUB_INSTALLATION_ID` | — | App installation ID for the target org/repo |
| `PORT` | `3000` | HTTP port for the control plane |
| `MAIN_BRANCH` | `main` | Name of the protected main branch |
| `DEVELOP_BRANCH` | `develop` | Name of the integration branch |

## Relationship to the portfolio

`conductor` runs one ticket to a PR. `harbormaster` is the layer above: it schedules many `conductor` runs apart, integrates their output safely through a merge queue, and ships the work on the record. `spelunk` powers the impact analysis. `watchtower` observes the fleet.
