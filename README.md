# harbormaster

A coordination layer for a fleet of AI coding agents on one repo. It schedules work so agents rarely collide, integrates optimistically through a merge queue so the rare collision is cheap, and runs the whole thing under ticketed, on-the-record release management.

**Stack:** Node 20 / TypeScript · Postgres · GitHub App · Linear

## The problem it solves

Running multiple autonomous coding agents on the same repo creates merge collisions. harbormaster prevents them at the source (scheduling), absorbs the ones that slip through (optimistic merge queue), and maintains a full audit trail of every dispatch and merge.

Three layers, in priority order:

1. **Conflict-aware scheduler** — estimates impact surface per ticket, runs non-overlapping tickets in parallel, sequences or merges overlapping ones. Most collisions never happen.
2. **Optimistic merge queue** — wraps GitHub merge queue / Mergify. Every agent works in its own worktree. Integration serializes: rebase, CI on the merged result, merge on green. A loser re-runs automatically.
3. **Advisory leases for hotspots** — migrations and shared contracts get a lock. The other 95% stays lock-free.

## Status

**M0 Scaffold complete.** See [PROGRESS.md](./PROGRESS.md) for the milestone tracker.

## Project layout

```
src/
  release/          # ported release.sh lifecycle (semver, branches, tags, hotfix, sync)
  db/               # Postgres connection, migration runner, TypeScript schema types
    migrations/     # SQL migration files (applied in order)
  integrations/
    github/         # GitHub App (webhook registration, push enforcement)
    linear/         # Linear API client stub (M7)
  config.ts         # Zod-validated config from environment
  index.ts          # Control-plane entry point
tests/
  release/          # Unit tests for the release module (35 tests)
.github/
  workflows/
    ci.yml          # Typecheck → lint → build → test on every push/PR
```

## Getting started

### Prerequisites

- Node 20+
- Postgres 14+

### Setup

```bash
npm install
cp .env.example .env
# edit .env with your DATABASE_URL, GitHub App credentials, etc.
```

### Development

```bash
npm run dev          # ts-node watch mode
npm test             # run tests
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run build        # compile to dist/
```

### Database

Run migrations before starting the service:

```typescript
import { getPool } from './src/db'
import { runMigrations } from './src/db/migrate'

await runMigrations(getPool(), './src/db/migrations')
```

### GitHub App

Set `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, and `GITHUB_WEBHOOK_SECRET` in your `.env`. Without these, the GitHub integration is disabled and the service still starts.

## Release lifecycle

The `src/release/` module is a TypeScript port of the `ggsa-spt/release.sh` workflow:

| Function | Description |
|----------|-------------|
| `autoNextRelease(git)` | Bumps the next minor version off the latest tag and creates `release/<version>` from main |
| `createReleaseBranch(git, version)` | Creates a `release/<version>` branch |
| `tagMain(git, version)` | Tags HEAD as `v<version>` with two idempotency guards (tag-exists, has_post_release_run) |
| `hotfixStart(git)` | Bumps the patch version and creates `hotfix/<version>` |
| `hotfixFinish(git, branch, targets)` | Merges the hotfix into main, develop, and any active release branches |
| `syncDevelop(git)` | Merges main into develop, auto-resolving the package.json version conflict |
| `featureBranchName({type, ticketId, description})` | Returns `feat/ENG-123/add-user-auth` style branch name |

## Next milestone

**M1 — Worktrees + queue:** per-task git worktrees for agent isolation, adapter over GitHub merge queue / Mergify.
