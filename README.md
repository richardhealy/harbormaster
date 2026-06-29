# harbormaster

A coordination layer for a fleet of AI coding agents sharing one repository. It schedules work so agents rarely collide, integrates optimistically through a merge queue, and runs releases under ticketed, on-the-record management.

**Stack:** Node.js / TypeScript · Postgres · GitHub App · Linear

---

## The core idea

Three layers, in order of importance:

1. **Schedule against impact** — estimate each ticket's impact surface before dispatch. Run non-overlapping tickets in parallel, sequence overlapping ones, and merge clearly colliding ones into a single job. Most collisions never happen because the work was never dispatched concurrently.
2. **Integrate optimistically** — every agent works in its own worktree off the current tip. A merge queue serializes integration: rebase, CI on the merged result, merge on green. A loser re-runs against the new tip automatically.
3. **Advisory leases for hotspots only** — a small declared set (migrations, shared contracts) gets an advisory lock. That's the exception, not the architecture.

---

## Architecture

```
src/
  scheduler/         # impact estimation, parallel/sequence/merge planning  (M3)
  impact/            # dependency graph + static analysis                    (M3)
  integration/
    worktrees/       # per-task isolation off the current tip                (M1)
    queue/           # adapter over GitHub merge queue / Mergify             (M1)
    semantic/        # cross-branch typecheck/build conflict detection       (M4)
    rerun/           # re-dispatch the losing change against the new tip     (M2)
  hotspots/          # advisory leases for declared un-mergeable spots       (M5)
  release/           # release lifecycle: semver, branches, tags, hotfix     (M0)
  gates/             # scope / CI / QA / HITL, per-domain policy             (M6)
  provenance/        # immutable audit log                                   (M7)
  releases/          # Linear-planned releases, manifests, notes, freezes   (M8)
  integrations/
    github/          # GitHub App: webhooks, protected-branch enforcement    (M0)
    linear/          # Linear GraphQL client: ticket sync, cycles            (M7)
  agent-iface/
    cli/             # CLI agent interface                                   (M9)
    mcp/             # MCP server agent interface                            (M9)
  db/
    schema.sql       # Postgres schema (tickets, audit log, leases, releases)
    client.ts        # pg Pool wrapper
    migrate.ts       # schema migration runner
  app.ts             # control-plane HTTP server entry point
```

---

## Getting started

### Prerequisites

- Node.js 22+
- Postgres 15+

### Install

```bash
npm install
```

### Configure

Copy `.env.example` to `.env` and fill in:

```env
DATABASE_URL=postgres://user:pass@localhost:5432/harbormaster
PORT=3000

# GitHub App
GITHUB_APP_ID=
GITHUB_PRIVATE_KEY=
GITHUB_WEBHOOK_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
```

### Migrate

```bash
npm run migrate
```

### Run

```bash
npm run dev      # development (ts-node)
npm run build    # compile
npm start        # production
```

### Test

```bash
npm test
```

---

## Release lifecycle

The `src/release/` module ports the core of the `ggsa-spt` `release.sh` lifecycle:

| Class | Responsibility |
|---|---|
| `SemverBumper` | Read the latest git tag, compute next semver, check idempotency guards |
| `ReleaseBranchManager` | `create-branch`, `auto-next-release`, `tag-main` (idempotent) |
| `HotfixManager` | `hotfix-start`, `hotfix-finish` with fan-out to main + develop + active release branches |
| `SyncManager` | `sync-develop` with package.json conflict auto-resolve; feature branch naming convention |

---

## Status

See [PROGRESS.md](PROGRESS.md) for the milestone checklist.
