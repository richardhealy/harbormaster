# harbormaster

A coordination layer for a fleet of AI coding agents. It schedules work so agents rarely collide, integrates optimistically through a merge queue so the rare collision is cheap, and runs the whole thing under ticketed, on-the-record release management.

**Stack:** Node.js / TypeScript, Postgres, GitHub App, Linear.

## The problem it solves

Running multiple autonomous coding agents on the same repository without them stepping on each other. Harbormaster does this in three layers:

1. **Schedule against impact** — estimate each ticket's impact surface and dispatch non-overlapping tickets in parallel. Overlapping tickets are sequenced or merged into one job. Most collisions never happen.
2. **Integrate optimistically** — every agent works in its own git worktree off the current tip. The merge queue rebases, runs CI, and merges on green. A conflict surfaces as a failed rebase or red CI; the losing change is automatically re-dispatched.
3. **Advisory leases for hotspots only** — a small declared set of un-mergeable paths (migrations, shared contracts) gets an advisory lock. Everything else is lock-free.

## Project layout

```
src/
  scheduler/       # impact estimation, parallel/sequence/merge planning
  impact/          # dependency graph + static analysis
  integration/
    worktrees/     # per-task git worktree isolation
    queue/         # adapter over GitHub merge queue / Mergify
    semantic/      # cross-branch typecheck/build conflict detection
    rerun/         # re-dispatch losing changes
  hotspots/        # advisory leases for un-mergeable paths
  release/         # release lifecycle: semver, branches, tags, hotfix, sync-develop
  gates/           # scope / CI / QA / HITL per-domain policy
  provenance/      # immutable audit log
  releases/        # Linear-planned releases, manifests, notes, freeze windows
  integrations/
    github/        # GitHub App client and webhook helpers
    linear/        # Linear ticket sync
  agent-iface/
    cli/           # agent-facing CLI
    mcp/           # MCP server for agent tool calls
  db/              # Postgres schema and client
```

## Getting started

```bash
# Install dependencies
npm install

# Copy env template and fill in your credentials
cp .env.example .env

# Type-check
npm run typecheck

# Run tests
npm test

# Lint
npm run lint
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Postgres connection string |
| `GITHUB_APP_ID` | Yes | GitHub App ID |
| `GITHUB_APP_PRIVATE_KEY` | Yes | GitHub App private key (PEM) |
| `GITHUB_WEBHOOK_SECRET` | Yes | Webhook secret for signature verification |
| `LINEAR_API_KEY` | Yes | Linear API key |
| `PORT` | No | HTTP server port (default 3000) |

## Status

See [PROGRESS.md](./PROGRESS.md) for the current milestone status.

## Relationship to the portfolio

- `conductor` runs one ticket to a PR.
- `harbormaster` is the layer above: scheduling many conductor runs safely.
- `spelunk` powers the impact analysis.
- `watchtower` observes the fleet.
