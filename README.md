# harbormaster

A coordination layer for a fleet of AI coding agents on one repository. It schedules work so agents rarely collide, integrates optimistically through a merge queue so the rare collision is cheap, and runs the whole thing under ticketed, on-the-record release management.

## The core idea

Locks are the wrong abstraction for AI agents. Redo costs minutes and pennies. harbormaster instead:

1. **Schedules against impact** — estimates each ticket's impact surface, runs non-overlapping tickets in parallel, sequences overlapping ones, and merges highly-overlapping tickets into one job. Most collisions never happen.
2. **Integrates optimistically** — every agent works in its own worktree off the current tip. The merge queue rebases, runs CI on the merged result, and merges on green. A conflict shows up as a failed rebase or red CI; the loser re-runs automatically.
3. **Leases hotspots only** — migrations, shared contracts, and other genuinely un-mergeable spots get an advisory lock. Everything else runs lock-free.

## Stack

Node / TypeScript · PostgreSQL · GitHub App · Linear

## Getting started

```bash
cp .env.example .env   # fill in credentials
npm install
npm run build
npm start
```

### Environment variables

| Variable | Description |
|----------|-------------|
| `PORT` | HTTP port (default: 3000) |
| `DATABASE_URL` | Postgres connection string |
| `GITHUB_APP_ID` | GitHub App ID |
| `GITHUB_PRIVATE_KEY` | GitHub App private key (PEM) |
| `GITHUB_WEBHOOK_SECRET` | GitHub webhook HMAC secret |
| `LINEAR_API_KEY` | Linear API key |
| `LINEAR_WEBHOOK_SECRET` | Linear webhook HMAC secret |
| `MERGE_QUEUE_PROVIDER` | `github` (default) or `mergify` |

## Development

```bash
npm test            # run test suite
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
npm run build       # compile to dist/
```

## Architecture

```
src/
  scheduler/          impact estimation, parallel/sequence/merge planning
  impact/             dependency graph + static analysis
  integration/
    worktrees/        per-task isolation off the current tip
    queue/            adapter over GitHub merge queue / Mergify
    semantic/         cross-branch typecheck/build conflict detection
    rerun/            re-dispatch the losing change against the new tip
  hotspots/           advisory leases for un-mergeable spots only
  release/            semver, branch lifecycle, tagging, hotfix, sync-develop
  gates/              scope / CI / QA / HITL, per-domain policy
  provenance/         immutable audit log: ticket, agent, approvals, release
  integrations/
    github/           GitHub App webhook handling, check runs
    linear/           Linear GraphQL client, webhook verification
  agent-iface/
    cli/              CLI command interface
    mcp/              MCP tool definitions for agent integration
  db/                 Postgres pool, migrations
  server.ts           Express HTTP server
  config.ts           Environment configuration
```

## Milestones

| # | Milestone | Status |
|---|-----------|--------|
| M0 | Scaffold — control plane, Postgres, GitHub App, release lifecycle, CI green | ◐ In progress |
| M1 | Worktrees + queue — per-task worktrees, merge queue adapter | ☐ Not started |
| M2 | Optimistic re-run — rebase, CI-on-result, automatic loser re-dispatch | ☐ Not started |
| M3 | Impact + scheduler — impact estimation, parallel/sequence/merge dispatch | ☐ Not started |
| M4 | Semantic conflicts — cross-branch typecheck/build detection | ☐ Not started |
| M5 | Hotspot leases — advisory locks for declared un-mergeable set | ☐ Not started |
| M6 | Gates — scope / CI / QA / HITL, per-domain policy | ☐ Not started |
| M7 | Linear + provenance — ticket sync, immutable audit log | ☐ Not started |
| M8 | Releases — Linear-planned releases, manifests, notes, freezes | ☐ Not started |
| M9 | Agent interface — CLI + MCP, end-to-end fleet demo | ☐ Not started |
