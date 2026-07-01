# How-to guides

Task-oriented recipes for the four things harbormaster does. Each recipe is a
copy-pasteable sequence of CLI calls, verified against the current build. For
request/response field reference see [docs/api.md](./api.md); for how the
pieces fit together see [docs/architecture.md](./architecture.md); for wiring
harbormaster into GitHub/Linear see [docs/integration.md](./integration.md).

All examples assume you're in the repo root with dependencies installed
(`npm install`). Commands that touch Postgres need `DATABASE_URL` set and
migrations applied — see [Prerequisites](#prerequisites).

## Prerequisites

```bash
cp .env.example .env
# edit .env: DATABASE_URL at minimum
```

```typescript
// scripts/migrate.ts, or run inline with tsx
import { getPool } from './src/db'
import { runMigrations } from './src/db/migrate'

await runMigrations(getPool(), './src/db/migrations')
```

Commands that only touch in-memory state — `schedule plan`, all `hotspot *`
commands, `gate run` — work with no database at all.

## Recipe: run the headline scheduler demo

This is the spec's "headline test": tickets with overlapping impact surfaces
must not be scheduled to run concurrently. Three tickets, two of which share
files:

```bash
npm run cli -- schedule plan '{
  "tickets": [
    { "ticketId": "ENG-101", "title": "Refactor release branch logic", "expectedFiles": ["src/release/branch.ts", "src/release/tags.ts"] },
    { "ticketId": "ENG-102", "title": "Fix release tag idempotency bug", "expectedFiles": ["src/release/tags.ts"] },
    { "ticketId": "ENG-103", "title": "Add docs for hotspot leases", "expectedFiles": ["docs/architecture.md"] }
  ]
}'
```

ENG-101 and ENG-102 share `src/release/tags.ts`; their Jaccard overlap is
0.5, at the default `mergeThreshold`, so the scheduler folds them into one
job (`decision: "merge"`) instead of dispatching them concurrently. ENG-103
touches none of those files and lands in the same wave as its own
`decision: "parallel"` entry. Nothing runs the two release tickets side by
side — the collision was prevented before either agent started.

To see the middle case — partial overlap that's too small to merge but too
large to ignore — lower the shared surface below `mergeThreshold` (0.5):

```bash
npm run cli -- schedule plan '{
  "tickets": [
    { "ticketId": "ENG-201", "title": "A", "expectedFiles": ["src/a.ts", "src/b.ts", "src/c.ts"] },
    { "ticketId": "ENG-202", "title": "B", "expectedFiles": ["src/c.ts", "src/d.ts", "src/e.ts"] }
  ]
}'
```

Overlap is 1 shared file / 5 total = 0.2: above `sequenceThreshold` (0) but
below `mergeThreshold` (0.5), so ENG-202 gets `decision: "sequence"` and
lands in the wave after ENG-201 instead of running in parallel with it.

Tune both thresholds per call with `mergeThreshold` / `sequenceThreshold` in
the request body if the defaults are too aggressive or too loose for your
repo's file granularity.

## Recipe: declare a hotspot and take an advisory lease

Hotspots are the 5% the scheduler can't reason about from file overlap alone
(migrations, one shared contract file). Register a pattern once, then agents
acquire/release leases around touching it.

Leases live in an in-process singleton (see
[Statefulness](./integration.md#2-driving-it-as-an-agent-cli--mcp)), so this only works
across calls that share a process — the MCP server, or a script calling
`src/agent-iface/commands.ts` directly. Each CLI invocation is a fresh
process, so `hotspot register` and `hotspot acquire` as *separate* `npm run
cli` calls won't see each other's state; use one of the two persistent
surfaces instead:

```typescript
import { registerHotspot, acquireLease, releaseLease } from './src/agent-iface/commands'

registerHotspot({
  name: 'db-migrations',
  patterns: ['src/db/migrations/**'],
  reason: 'Sequential schema changes must not collide',
})

const first = acquireLease({ files: ['src/db/migrations/002_add_index.sql'], holderId: 'disp-1' })
// → { status: 'granted', lease: { id: 'lease-1', holderId: 'disp-1', ... } }

const second = acquireLease({ files: ['src/db/migrations/002_add_index.sql'], holderId: 'disp-2' })
// → { status: 'blocked', blockedBy: { id: 'lease-1', holderId: 'disp-1', ... } }

releaseLease({ leaseId: first.lease.id })

const third = acquireLease({ files: ['src/db/migrations/002_add_index.sql'], holderId: 'disp-2' })
// → { status: 'granted', lease: { id: 'lease-2', holderId: 'disp-2', ... } }
```

A file outside every registered pattern always returns `status:
'not-required'` — the rest of the repo stays lock-free by construction, not
by convention.

Via the MCP server the same sequence is
`hotspot_register` → `hotspot_acquire` → `hotspot_release`, called by name
from any MCP client; leases persist for the life of that server process.

## Recipe: run the gate pipeline for a change

Every merge clears scope/CI/QA/HITL, gated by the risk policy of the domains
it touches. This call resolves the `release` domain to the medium-risk
policy (`requiresQA: true`, 50% scope-drift threshold) and reports the
agent-observed CI status:

```bash
npm run cli -- gate run '{
  "dispatchId": "disp-42",
  "ticketId": "ENG-42",
  "branch": "feat/ENG-42/x",
  "domains": ["release"],
  "expectedFiles": ["src/release/branch.ts"],
  "actualFiles": ["src/release/branch.ts"],
  "ciStatus": "success",
  "qaResult": { "passed": true }
}'
```

`gates` in the response lists each stage in order (`scope`, `ci`, `qa`) with
its own pass/fail — the pipeline stops at the first failure, so a scope-drift
failure means CI and QA never run for that dispatch. Add `"domains":
["db"]` instead to see the high-risk policy kick in (`requiresHITL: true`,
20% threshold) — that run needs `"approved": true/false` in the payload or
it stops at the `hitl` stage. See the [domain risk table](./api.md#domain-risk-policy)
for every domain → policy mapping.

## Recipe: record and query provenance

Requires `DATABASE_URL` and migrations applied. Every gate decision, dispatch,
and merge should be recorded so it's traceable to a ticket and an actor:

```bash
npm run cli -- provenance record '{
  "eventType": "dispatch.created",
  "actor": "scheduler",
  "ticketId": "ENG-42",
  "payload": { "branch": "feat/ENG-42/x" }
}'
# → { "id": "<uuid>" }

npm run cli -- provenance query '{ "ticketId": "ENG-42" }'
# → [{ "id": "...", "eventType": "dispatch.created", "ticketId": "ENG-42", "actor": "scheduler", "payload": {...}, "createdAt": "..." }]
```

`eventType` must be one of the values in `AUDIT_EVENT_TYPES`
(`src/provenance/types.ts`) — `dispatch.*`, `gate.*`, `merge.*`,
`release.*`, `ticket.*`. The audit log is append-only: there is no update or
delete command by design.

## Recipe: run a release end to end

Requires `DATABASE_URL` and migrations applied.

```bash
npm run cli -- release create '{ "version": "1.2.0", "branch": "release/1.2.0" }'
# → { "id": "<uuid>", "version": "1.2.0", "status": "planning", ... }

npm run cli -- release list '{}'
# → [{ "id": "<uuid>", "version": "1.2.0", "status": "planning", ... }]
```

`release manifest` pulls tickets from Linear (needs `LINEAR_API_KEY` and a
real `linearClient` — see [docs/integration.md](./integration.md#4-linear-integration))
and persists the manifest to the release row. `release notes` is a pure
function over an already-built manifest, so it works offline once you have
one:

```bash
npm run cli -- release notes '{
  "manifest": {
    "releaseId": "<uuid>", "version": "1.2.0", "generatedAt": "2026-07-01T00:00:00.000Z",
    "tickets": [{ "id": "t1", "identifier": "ENG-1", "title": "Add hotfix support", "status": "Done", "priority": 2, "labels": ["feat"] }],
    "summary": { "total": 1, "byStatus": { "Done": 1 }, "byPriority": { "2": 1 } }
  }
}'
# → "# Release 1.2.0\n\n> Generated: 2026-07-01T00:00:00.000Z\n> Tickets: 1\n\n## Features\n\n- ENG-1 Add hotfix support\n"
```

Tickets are bucketed into Features/Fixes/Improvements/Other by label — see
`generateNotes` in [docs/architecture.md](./architecture.md) for the
categorisation rules.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `provenance`/`release` commands throw a connection error | `DATABASE_URL` unset or Postgres unreachable | Set `DATABASE_URL` in `.env` / the environment; confirm Postgres is running and migrations are applied |
| A relation does not exist (e.g. `audit_log`) | Migrations not applied | Run `runMigrations(getPool(), './src/db/migrations')` before calling any DB-backed command |
| `hotspot acquire` always returns `not-required` across separate CLI calls | Each `npm run cli` invocation is a fresh process; the in-memory lease manager doesn't survive between them | Use the MCP server, or call `src/agent-iface/commands.ts` directly in one script/process (see the hotspot recipe above) |
| Zod validation error on a command that "should" work | Field name/shape mismatch with the schema | Check the exact shape in [docs/api.md](./api.md) or `src/agent-iface/schemas.ts` — schemas are shared by both CLI and MCP, so the same payload works on either surface |
| `gate run` stops at the `hitl` stage even though CI and QA passed | The resolved domain policy has `requiresHITL: true` (e.g. `db`, `hotspots`, `provenance`) | Pass `"approved": true` once a human has actually signed off; this is enforced, not optional, for high-risk domains |
| GitHub App fields left blank in `.env` | Expected for local CLI/scheduler work | The GitHub App is only needed for the webhook receiver and merge-queue adapter (see [docs/integration.md](./integration.md#3-github-integration)); everything else runs without it |
