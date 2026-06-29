# harbormaster

A coordination layer for a fleet of AI coding agents on one repo.

**Status:** M0 complete — scaffold, release lifecycle, Postgres schema, GitHub App, CI.

## What it does

harbormaster lets many AI coding agents share a repository safely:

1. **Scheduling** — estimates impact per ticket and dispatches non-overlapping work in parallel, sequencing overlapping tickets and merging clearly-adjacent ones into a single job. Most collisions never happen because the work is never concurrently dispatched.
2. **Optimistic integration** — every agent works in its own worktree off the current tip; integration serializes through a merge queue (GitHub merge queue or Mergify). A rebase failure or red CI flags the collision; the losing agent re-runs automatically.
3. **Advisory leases** — hotspots (migrations, shared contracts) get a lease; the rest of the repo stays lock-free.

## Stack

Node / TypeScript · PostgreSQL · GitHub App · Linear

## Architecture

```
src/
  release/          # ported release.sh lifecycle: branch, tag, hotfix, sync-develop
  db/               # Postgres connection pool and schema
  scheduler/        # impact estimation, parallel/sequence/merge dispatch plan
  impact/           # dependency graph + static analysis
  integration/
    worktrees/      # per-task isolation off the current tip
    queue/          # adapter over GitHub merge queue / Mergify
    semantic/       # cross-branch typecheck/build conflict detection
    rerun/          # re-dispatch the losing change against the new tip
  hotspots/         # advisory leases for un-mergeable spots
  gates/            # scope / CI / QA / HITL, per-domain policy
  provenance/       # immutable audit log: ticket, agent, approvals, release
  releases/         # Linear-planned releases, manifests, notes, freezes
  integrations/
    github/         # GitHub App setup
    linear/         # Linear client types
  agent-iface/
    cli/            # CLI interface
    mcp/            # MCP server
```

## Getting started

### Prerequisites

- Node.js 20+
- PostgreSQL 16+

### Install

```bash
npm install
```

### Configure

```bash
cp .env.example .env
# fill in DATABASE_URL, GITHUB_APP_*, LINEAR_API_KEY
```

### Build and test

```bash
npm run build
npm test
npm run lint
```

### Apply database schema

```bash
npm run db:migrate
```

## Release lifecycle

The `release/` module ports the `ggsa-spt` `release.sh` script with real Linear integration:

| Operation | Description |
|-----------|-------------|
| `autoNextRelease(type)` | Determine the next version from git tags |
| `createReleaseBranch(version)` | Create `release/x.y.z` off main |
| `tagMain(version)` | Tag main with idempotency guard |
| `hotfixStart(base)` | Create `hotfix/x.y.z` from the base tag |
| `hotfixFinish(branch, targets)` | Merge hotfix into main, develop, and active release branches |
| `syncDevelop()` | Sync develop with main; auto-resolve `package.json` conflicts |
| `featureBranchName(type, ticket, desc)` | Conventional-commit branch name with ticket id |
