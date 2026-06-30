# Agent interface API reference

harbormaster has no HTTP API. The surface agents drive is the **agent
interface** (`src/agent-iface/`): one set of commands, exposed two ways —

- a single-shot **CLI** (`harbormaster <command> '<json>'`), and
- a long-running **MCP server** (one tool per command, stdio transport).

Both are thin adapters over the same functions in `src/agent-iface/commands.ts`
and validate input with the same [zod](https://zod.dev) schemas
(`src/agent-iface/schemas.ts`), so this reference covers both surfaces at
once: the request shape, validation rules, and response shape are identical
either way. Only the transport differs.

## Conventions

### CLI

```bash
harbormaster <command> '<json-payload>'        # payload as the last argument
harbormaster <command> --stdin <<< '<json>'     # or piped via stdin
harbormaster --help                             # lists every command
```

- The payload is always a single JSON object (omit it, or pass `{}`, for
  commands that take no input).
- On success the command's return value is printed to stdout as pretty-printed
  JSON and the process exits `0`.
- On failure, nothing is printed to stdout; a one-line message goes to stderr
  and the process exits `1`. Validation failures are prefixed
  `Invalid input: `; everything else prints the underlying error message.
- `runCli(argv)` (`src/agent-iface/cli/index.ts`) is the same dispatcher used
  by `bin/harbormaster`, exported so tests (and embedders) can invoke it
  without spawning a process.

### MCP server

```bash
npm run mcp                                   # dev, via tsx
node dist/agent-iface/mcp/index.js            # after `npm run build`
```

Point any MCP-compatible client (Claude Code, Cursor, etc.) at that stdio
process. Each tool is registered with an `inputSchema` generated from the same
zod shape the CLI validates against, so a client can introspect the schema
before calling.

- Success: `{ content: [{ type: 'text', text: '<pretty-printed JSON>' }] }`
- Failure: same shape with `isError: true`; `text` is `Invalid input: <zod
  message>` for validation errors, or the raw error message otherwise.

### Authentication & configuration

There is no per-call auth — the agent interface assumes it's running inside a
trusted process (CLI on an agent's machine, or an MCP server the agent spawns
itself). Configuration is environment-only, validated by `loadConfig()`
(`src/config.ts`) on first use:

| Variable | Required | Used by |
|---|---|---|
| `DATABASE_URL` | No — defaults to `postgresql://localhost:5432/harbormaster` | `provenance_*`, `release_*` commands (Postgres-backed) |
| `LINEAR_API_KEY` | Only for `release_manifest` when no `linearClient` is injected | Fetching tickets from Linear |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET` | No | GitHub App (control-plane process, not the agent interface) |

`schedule_plan`, `hotspot_*`, and `gate_run` need no configuration — they're
pure/in-memory and run with zero setup.

### Error cases

Every command can fail in one of two ways:

1. **Validation error** — the payload doesn't match the command's zod schema
   (missing required field, wrong type, empty array where `min(1)` is
   required, etc). Reported as `Invalid input: <zod message>`.
2. **Runtime error** — e.g. `release_manifest` without `LINEAR_API_KEY`
   configured and no injected client, or a Postgres connection failure for any
   `provenance_*`/`release_*` command. Reported as the raw error message.

Neither surface returns a structured error code; treat any non-zero CLI exit
code, or `isError: true` from the MCP tool, as a failure and parse the message
text.

---

## Scheduling

### `schedule_plan`

CLI: `harbormaster schedule plan '<json>'` · MCP tool: `schedule_plan`

Estimates each ticket's impact surface (files, directories, domains) and
produces a conflict-aware dispatch plan: which tickets are safe to run in
parallel, which must be sequenced, and which should be merged into one agent
job because they overlap heavily. Pure computation — no database, no network.

**Request**

| Field | Type | Required | Notes |
|---|---|---|---|
| `tickets` | array of ticket objects, min 1 | Yes | See below |
| `mergeThreshold` | number, 0–1 | No | Jaccard overlap above this → `merge` decision. Default `0.5`. |
| `sequenceThreshold` | number, 0–1 | No | Jaccard overlap above this (and below `mergeThreshold`) → `sequence`. Default `0`. |

Each ticket object:

| Field | Type | Required | Notes |
|---|---|---|---|
| `ticketId` | string, non-empty | Yes | |
| `title` | string, non-empty | Yes | Used for keyword-based impact inference when `expectedFiles` is absent |
| `description` | string | No | Also used for keyword inference |
| `labels` | string[] | No | Label-based impact inference (confidence 0.6) |
| `expectedFiles` | string[] | No | Explicit files (confidence 1.0) — most accurate, preferred when known |
| `priority` | number | No | Lower = higher priority; influences ordering within a wave |

**Response** — a `DispatchPlan`:

```jsonc
{
  "waves": [
    [ /* ScheduledGroup[] — wave 0, runs in parallel */ ],
    [ /* ScheduledGroup[] — wave 1, runs after wave 0 completes */ ]
  ],
  "groups": [ /* flat list of all ScheduledGroup, execution order */ ],
  "mergeCount": 0,
  "ticketCount": 3,
  "createdAt": "2026-06-30T12:00:00.000Z"
}
```

A `ScheduledGroup`:

| Field | Type | Notes |
|---|---|---|
| `id` | string | `ticketId` for single-ticket groups, joined ids for merges |
| `tickets` | string[] | Ticket IDs in this group (length > 1 only for `merge`) |
| `decision` | `'parallel' \| 'sequence' \| 'merge'` | |
| `reason` | string | Human-readable explanation |
| `overlapScore` | number? | Jaccard score that triggered merge/sequence |
| `combinedSurface` | `ImpactSurface`? | Union of all member tickets' impact surfaces |

---

## Hotspots

In-memory advisory leases for the small set of paths declared un-mergeable
(migrations, shared contracts). Backed by a process-wide singleton
(`getHotspotManager()`), so leases persist for the life of one MCP server
session but **not** across separate CLI invocations — each CLI call is a
fresh process. Use the MCP server, or the library directly, when leases need
to outlive a single command.

### `hotspot_check`

CLI: `harbormaster hotspot check '<json>'` · MCP tool: `hotspot_check`

Checks whether a file list touches a registered hotspot, without acquiring a
lease.

**Request**: `{ "files": string[] }` (min 1 file)

**Response** — a `HotspotCheckResult`:

```jsonc
{
  "touchesHotspot": true,
  "matches": [
    { "hotspot": { "name": "db-migrations", "patterns": ["src/db/migrations/"], "reason": "..." },
      "matchedFiles": ["src/db/migrations/002_x.sql"] }
  ]
}
```

### `hotspot_register`

CLI: `harbormaster hotspot register '<json>'` · MCP tool: `hotspot_register`

Declares (or replaces, by `name`) a hotspot.

**Request**

| Field | Type | Required |
|---|---|---|
| `name` | string, non-empty | Yes |
| `patterns` | string[], min 1 | Yes — glob-style: trailing `/` = directory prefix, `*` = one segment, `**` = any segments |
| `reason` | string, non-empty | Yes |

**Response**: `{ "registered": true, "hotspot": Hotspot }`

### `hotspot_acquire`

CLI: `harbormaster hotspot acquire '<json>'` · MCP tool: `hotspot_acquire`

Requests an advisory lease before touching files that may be a hotspot.

**Request**

| Field | Type | Required |
|---|---|---|
| `holderId` | string, non-empty | Yes — dispatch/agent id |
| `files` | string[], min 1 | Yes — files the dispatch intends to modify |
| `ttlMs` | number, positive | No — omit for a lease with no automatic expiry |

**Response** — a `LeaseResult`:

| Field | Type | Notes |
|---|---|---|
| `status` | `'granted' \| 'blocked' \| 'not-required'` | `not-required` when no file matches a hotspot — no lease is taken |
| `lease` | `Lease`? | Present when `status === 'granted'` |
| `blockedBy` | `Lease`? | The conflicting lease, present when `status === 'blocked'` |
| `hotspot` | `Hotspot`? | The matched hotspot, present for `granted`/`blocked` |
| `matchedFiles` | string[] | Files from the request that matched |

### `hotspot_release`

CLI: `harbormaster hotspot release '<json>'` · MCP tool: `hotspot_release`

**Request**: `{ "leaseId": string }`
**Response**: `{ "released": boolean }` — `false` if the id wasn't found.

### `hotspot_release_by_holder`

CLI: `harbormaster hotspot release-by-holder '<json>'` · MCP tool: `hotspot_release_by_holder`

Releases every lease held by a given dispatch/agent id — call this on
dispatch completion or failure so a crashed agent doesn't hold a lease
forever.

**Request**: `{ "holderId": string }`
**Response**: `{ "count": number }`

### `hotspot_list_active`

CLI: `harbormaster hotspot list` (no payload) · MCP tool: `hotspot_list_active`

**Request**: none
**Response**: `Lease[]` — all currently active (non-expired) leases.

---

## Gates

### `gate_run`

CLI: `harbormaster gate run '<json>'` · MCP tool: `gate_run`

Runs a dispatch through the scope → CI → QA → HITL pipeline under the policy
resolved for its domains, short-circuiting at the first failed stage. Unlike
the library-level `GatePipeline`, this command doesn't call out to live CI/QA
infrastructure itself — the agent reports the CI status it already observed
(and, where applicable, the QA result and approval decision it has in hand).

**Request**

| Field | Type | Required | Notes |
|---|---|---|---|
| `dispatchId` | string, non-empty | Yes | |
| `ticketId` | string, non-empty | Yes | |
| `branch` | string, non-empty | Yes | |
| `domains` | string[] | No (default `[]`) | Resolves the policy — see [domain risk table](#domain-risk-policy) |
| `expectedFiles` | string[] | No (default `[]`) | From the impact estimate |
| `actualFiles` | string[] | No (default `[]`) | Files actually changed in the diff |
| `prNumber` | number | No | |
| `ciStatus` | `'success' \| 'failure' \| 'pending' \| 'unknown'` | Yes | |
| `qaResult` | `{ passed: boolean, reason?: string }` | No | Required for domains where `requiresQA` is true |
| `approved` | boolean | No | Required for domains where `requiresHITL` is true |

**Response** — a `GatePipelineResult`:

```jsonc
{
  "dispatchId": "disp-42",
  "policy": { "domain": "release", "riskLevel": "medium", "scopeDriftThreshold": 0.5, "requiresQA": true, "requiresHITL": false },
  "gates": [
    { "stage": "scope", "status": "pass" },
    { "stage": "ci", "status": "pass" },
    { "stage": "qa", "status": "pass" },
    { "stage": "hitl", "status": "skipped" }
  ],
  "passed": true
}
```

`blockedAt` (a `GateStage`) is present instead of being absent when `passed`
is `false`, naming the stage that failed.

#### Domain risk policy

`resolvePolicy(domains)` picks the **strictest** policy matching any input
domain; unrecognised domains fall back to the medium-risk default.

| Risk | Domains | Scope drift threshold | QA | HITL |
|---|---|---|---|---|
| low | `docs`, `readme` | 200% | – | – |
| medium (default) | `release`, `scheduler`, `impact`, `gates`, `agent-iface`, `agent-iface/cli`, `agent-iface/mcp`, `integration/worktrees`, `integration/queue`, `integration/rerun`, `integration/semantic`, `integrations/github`, `integrations/linear` | 50% | ✓ | – |
| high | `db`, `hotspots`, `provenance` | 20% | ✓ | ✓ |

---

## Provenance

Reads and writes to the immutable `audit_log` table. Requires `DATABASE_URL`
to point at a reachable Postgres instance with migrations applied.

### `provenance_record`

CLI: `harbormaster provenance record '<json>'` · MCP tool: `provenance_record`

Appends one event to the audit log.

**Request**

| Field | Type | Required |
|---|---|---|
| `eventType` | one of `AUDIT_EVENT_TYPES` (see below) | Yes |
| `payload` | object | No (default `{}`) |
| `ticketId` | string | No |
| `agentId` | string | No |
| `actor` | string, non-empty | Yes |

`AUDIT_EVENT_TYPES`: `dispatch.created`, `dispatch.rebase`, `dispatch.rerun`,
`dispatch.completed`, `dispatch.failed`, `gate.scope`, `gate.ci`, `gate.qa`,
`gate.hitl`, `merge.queued`, `merge.completed`, `merge.failed`,
`release.created`, `release.tagged`, `ticket.synced`, `ticket.status_updated`.

**Response**: `{ "id": string }` — the new audit log row id.

### `provenance_query`

CLI: `harbormaster provenance query '<json>'` · MCP tool: `provenance_query`

**Request** — all fields optional and AND-ed together:

| Field | Type |
|---|---|
| `ticketId` | string |
| `agentId` | string |
| `eventType` | one of `AUDIT_EVENT_TYPES` |
| `since` | ISO 8601 datetime string |
| `limit` | positive number |

**Response**: `PersistedAuditEvent[]`, each `{ id, eventType, payload, ticketId?, agentId?, actor, createdAt }`.

---

## Releases

Backed by the `releases` table; `release_manifest` additionally calls out to
Linear. Requires `DATABASE_URL`; `release_manifest` requires `LINEAR_API_KEY`.

### `release_create`

CLI: `harbormaster release create '<json>'` · MCP tool: `release_create`

**Request**

| Field | Type | Required |
|---|---|---|
| `version` | string, non-empty | Yes |
| `branch` | string, non-empty | Yes |
| `linearCycleId` | string | No |
| `freezeAt` | ISO 8601 datetime string | No |

**Response**: a `ReleaseRecord` in `planning` status — `{ id, version, branch, status, linearCycleId?, manifest?, notes?, freezeAt?, releasedAt?, createdAt, updatedAt }`.

### `release_list`

CLI: `harbormaster release list '<json>'` · MCP tool: `release_list`

**Request**: `{ "status"?: 'planning' | 'in_progress' | 'frozen' | 'released' | 'cancelled' }`
**Response**: `ReleaseRecord[]`, newest first; unfiltered when `status` is omitted.

### `release_manifest`

CLI: `harbormaster release manifest '<json>'` · MCP tool: `release_manifest`

Fetches the release's tickets from Linear (optionally filtered by label),
flattens them into the manifest shape, computes summary counts, and persists
the manifest to the release row.

**Request**

| Field | Type | Required |
|---|---|---|
| `releaseId` | string, non-empty | Yes |
| `teamId` | string, non-empty | Yes — Linear team id |
| `labelFilter` | string[] | No — only include tickets with one of these labels |

**Response** — a `ReleaseManifest`:

```jsonc
{
  "releaseId": "release-uuid-1",
  "version": "1.2.0",
  "generatedAt": "2026-06-30T12:00:00.000Z",
  "linearCycleId": "cycle-abc",
  "tickets": [
    { "id": "issue-1", "identifier": "ENG-1", "title": "Add OAuth flow", "status": "Done", "priority": 2, "labels": ["feat"], "assignee": "Alice", "url": "https://linear.app/issue/ENG-1" }
  ],
  "summary": { "total": 1, "byStatus": { "Done": 1 }, "byPriority": { "2": 1 } }
}
```

**Errors**: throws if `releaseId` doesn't exist, or if `LINEAR_API_KEY` isn't
configured (and no `linearClient` was injected — library callers only).

### `release_notes`

CLI: `harbormaster release notes '<json>'` · MCP tool: `release_notes`

Pure function — renders markdown release notes from an already-built
manifest. Takes no database dependency.

**Request**: `{ "manifest": ReleaseManifest }` (the full object returned by `release_manifest`)
**Response**: a markdown string, tickets bucketed into `## Features` / `## Fixes` / `## Improvements` / `## Other` by label keyword, each as `- [IDENTIFIER](url) title`.

---

## Worked example: schedule → gate → record → release

```bash
# 1. Plan two tickets
harbormaster schedule plan '{
  "tickets": [
    { "ticketId": "ENG-1", "title": "Refactor release branch logic", "expectedFiles": ["src/release/branch.ts"] },
    { "ticketId": "ENG-2", "title": "Add hotfix support", "expectedFiles": ["src/release/hotfix.ts"] }
  ]
}'
# → waves[0] contains both groups (decision: "parallel") — no file overlap

# 2. After CI passes on ENG-1's merged result, run it through the gate
harbormaster gate run '{
  "dispatchId": "disp-1", "ticketId": "ENG-1", "branch": "feat/ENG-1/refactor",
  "domains": ["release"], "expectedFiles": ["src/release/branch.ts"], "actualFiles": ["src/release/branch.ts"],
  "ciStatus": "success", "qaResult": { "passed": true }
}'
# → passed: true

# 3. Record the merge in the audit log
harbormaster provenance record '{
  "eventType": "merge.completed", "ticketId": "ENG-1", "agentId": "disp-1", "actor": "harbormaster-queue"
}'

# 4. Once a release is ready, build the manifest and render notes
harbormaster release manifest '{ "releaseId": "<id>", "teamId": "team-eng" }'
harbormaster release notes '{ "manifest": { ...output of the previous command... } }'
```
