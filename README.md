# harbormaster

A coordination layer for a fleet of AI coding agents on one repo. It schedules work so agents rarely collide, integrates optimistically through a merge queue so the rare collision is cheap, and runs the whole thing under ticketed, on-the-record release management.

**Stack:** Node.js / TypeScript · Postgres · GitHub App · Linear

## The problem it solves

Safe concurrency for autonomous coding agents — solved at the **planning** and **integration** layers rather than by locking files.

Three layers, in order of importance:

1. **Schedule against impact** — estimate each ticket's impact surface and avoid dispatching overlapping tickets concurrently. Most collisions never happen.
2. **Integrate optimistically through a merge queue** — each agent works in an isolated git worktree; integration serializes (rebase → CI → merge). A real conflict shows as a failed rebase, and the losing agent re-runs.
3. **Advisory leases for hotspots only** — a handful of genuinely un-mergeable spots (migrations, shared contracts) get an advisory lock. That's the exception, not the architecture.

## Current status

M0 (scaffold) is complete. See [PROGRESS.md](./PROGRESS.md) for the full milestone breakdown.

## Getting started

### Prerequisites

- Node.js 20+
- PostgreSQL 15+

### Install

```sh
npm install
```

### Configure

Copy `.env.example` to `.env` and fill in your values:

```sh
cp .env.example .env
```

### Database

Run migrations:

```sh
DATABASE_URL=postgres://... npm run db:migrate
```

### Run

```sh
npm run dev
```

### Test

```sh
npm test
```

### Lint + typecheck

```sh
npm run lint
npm run typecheck
```

## Repository layout

```
src/
  release/          # ported release lifecycle: branches, tags, hotfix, sync-develop
  db/               # Postgres pool + query helper
  integrations/
    github/         # GitHub App (webhooks, installation tokens)
    linear/         # Linear API (tickets, cycles, releases)
  scheduler/        # impact estimation, dispatch planning
  impact/           # dependency graph + static analysis
  integration/
    worktrees/      # per-task git worktree isolation
    queue/          # adapter over GitHub merge queue / Mergify
    semantic/       # cross-branch typecheck / build conflict detection
    rerun/          # re-dispatch losing change
  hotspots/         # advisory leases for un-mergeable spots
  gates/            # scope / CI / QA / HITL pipeline
  provenance/       # immutable audit log
  releases/         # Linear-planned releases, manifests, notes
  agent-iface/
    cli/            # CLI for agents
    mcp/            # MCP server for agents
migrations/         # node-pg-migrate SQL migrations
tests/              # Jest test suite
```

## Release lifecycle

The `src/release/` module ports the `ggsa-spt` `release.sh` lifecycle to a typed, testable service:

- **Semver bump** from the latest git tag (patch / minor / major).
- **`createRelease`** — creates a `release/X.Y` branch off main, bumps `package.json`.
- **`autoNextRelease`** — idempotent: creates the branch if missing, always updates the version.
- **`tagMain`** — idempotency-guarded: skips if the tag already exists or if there are no post-release commits.
- **`hotfixStart`** / **`hotfixFinish`** — hotfix branch off main; finish fans the merge out to main, develop, and all active release branches.
- **`syncDevelop`** — merges main into develop with `package.json` conflict auto-resolve.
- **`createFeatureBranch`** — conventional-commit naming: `type/TICKET-123-description`.
