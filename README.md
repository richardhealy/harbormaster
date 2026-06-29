# harbormaster

A coordination layer for a fleet of AI coding agents on one repo. It schedules work so agents rarely collide, integrates optimistically through a merge queue, and runs the whole thing under ticketed, on-the-record release management.

**Stack:** Node.js / TypeScript · Postgres · Fastify · GitHub App

## What it does

harbormaster solves one problem: *safe concurrency for autonomous coding agents*, at the planning and integration layers rather than by locking the editor.

Three layers, in priority order:

1. **Conflict-aware scheduler** — estimates each ticket's impact surface from the dependency graph, runs non-overlapping tickets in parallel, sequences overlapping ones, and merges clearly-colliding tickets into one job before dispatch.
2. **Optimistic merge queue** — every agent works in its own worktree off the current tip; integration serializes (rebase + CI on the merged result), and the loser re-runs automatically.
3. **Advisory leases for hotspots only** — migrations and shared contracts get an advisory lock; everything else stays lock-free.

## Quick start

```bash
cp .env.example .env
# fill in DATABASE_URL, GITHUB_APP_ID, GITHUB_WEBHOOK_SECRET
npm install
npm run build
npm start
```

## Development

```bash
npm install
npm run typecheck   # TypeScript type check
npm test            # run the test suite
```

## Architecture

```
src/
  index.ts          # Fastify server entry point
  db/               # Postgres client + schema migrations
  integrations/
    github/         # GitHub App webhook handler
    linear/         # Linear API client (M7)
  release/          # Ported release lifecycle (semver, branches, tags, hotfix, sync)
  scheduler/        # Impact estimation + dispatch planning (M3)
  impact/           # Dependency graph + static analysis (M3)
  integration/
    worktrees/      # Per-task git worktrees (M1)
    queue/          # Merge queue adapter (M1)
    semantic/       # Cross-branch typecheck/build (M4)
    rerun/          # Loser re-dispatch (M2)
  hotspots/         # Advisory leases (M5)
  gates/            # Scope / CI / QA / HITL pipeline (M6)
  provenance/       # Immutable audit log (M7)
  releases/         # Linear-planned releases, manifests (M8)
  agent-iface/
    cli/            # CLI for agents (M9)
    mcp/            # MCP server for agents (M9)
```

## Status

See [PROGRESS.md](./PROGRESS.md) for milestone tracking.

## License

MIT
