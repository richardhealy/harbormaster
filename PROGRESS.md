# PROGRESS

## Implementation

| # | Milestone | Status |
|---|-----------|--------|
| M0 | Scaffold: control-plane, Postgres, GitHub App, release/, CI | ☑ Done |
| M1 | Worktrees + queue | ☑ Done |
| M2 | Optimistic re-run | ☑ Done |
| M3 | Impact + scheduler | ☑ Done |
| M4 | Semantic conflicts | ☑ Done |
| M5 | Hotspot leases | ☑ Done |
| M6 | Gates | ☑ Done |
| M7 | Linear + provenance | ☑ Done |
| M8 | Releases | ☑ Done |
| M9 | Agent interface | ☑ Done |

### M0 — Scaffold (done)

- [x] Node 20 / TypeScript 5 project (package.json, tsconfig.json, tsconfig.build.json)
- [x] Directory layout matching spec: release/, db/, integrations/github/, integrations/linear/
- [x] Postgres schema + migration runner (`src/db/migrations/001_initial.sql`, `src/db/migrate.ts`)
  - audit_log, tickets, dispatches, gate_decisions, releases tables
- [x] GitHub App skeleton (`src/integrations/github/`)
  - App init via `@octokit/app`, webhook handlers (push, pull_request, check_suite)
- [x] Linear client stub (`src/integrations/linear/`)
- [x] Release lifecycle port from `release.sh` (`src/release/`)
  - [x] Semver bump from latest tag (`semver.ts`)
  - [x] `createReleaseBranch`, `autoNextRelease` (`branch.ts`)
  - [x] `tagMain` with tag-exists and has_post_release_run idempotency guards (`tags.ts`)
  - [x] `hotfixStart` / `hotfixFinish` with fan-out (`hotfix.ts`)
  - [x] `syncDevelop` with package.json conflict auto-resolve (`sync.ts`)
  - [x] Feature branch naming convention: `<type>/<ticketId>/<slug>` (`branch.ts`)
- [x] 35 unit tests across release module (all passing)
- [x] CI configuration (`.github/workflows/ci.yml`)
- [x] ESLint 9 flat config
- [x] `PROGRESS.md`, `README.md`, `CHANGELOG.md`

### M2 — Optimistic re-run (done)

- [x] `src/integration/rerun/rebase.ts` — `Rebaser` class
  - `rebase(worktreePath, newBase)`: runs `git rebase <newBase>` in the worktree via a per-directory `GitFactory`
  - On success: returns `{ outcome: 'success', headSha }`
  - On conflict: collects unmerged files via `diff --name-only --diff-filter=U`, aborts, returns `{ outcome: 'conflict', conflictFiles }`
  - On unexpected error: aborts the rebase and returns `{ outcome: 'error', error }`
- [x] `src/integration/rerun/ci.ts` — `CIChecker` class
  - `checkStatus(ref)`: queries `GET /repos/{owner}/{repo}/commits/{ref}/check-runs`
  - Aggregates to `'success' | 'failure' | 'pending' | 'unknown'`
  - `neutral` and `skipped` conclusions treated as passing; `timed_out`, `cancelled`, `action_required` as failure
- [x] `src/integration/rerun/index.ts` — `Rerunner` class
  - `shouldRetry(attempt, maxAttempts?)`: guard against infinite retry loops
  - `cleanup(dispatchId, prNumber?)`: removes worktree and dequeues PR; errors swallowed
  - `currentTip(branch)`: resolves HEAD SHA of a branch in the main repo
  - `handleFailure(options, redispatch)`: full orchestration — cleanup → get new tip → call redispatch callback → create new worktree; returns `{ exhausted: true }` on limit
- [x] `src/integration/rerun/types.ts` — `RebaseResult`, `CIResult`, `RerunOptions`, `RerunResult`, `RedispatchFn` types
- [x] 27 unit tests; total test count 90

### M3 — Impact + scheduler (done)

- [x] `src/impact/types.ts` — `ImpactEstimateInput`, `ImpactSurface`, `DomainMap`, `DEFAULT_DOMAIN_MAP`
- [x] `src/impact/index.ts` — `ImpactEstimator` class
  - `estimate(input)`: from explicit `expectedFiles` (confidence 1.0), labels (0.6), or title/description keywords (0.3)
  - Derives directories and domains from file paths using a configurable keyword map
  - `jaccardSimilarity(a, b)`: set intersection / union for file/domain arrays
  - `computeOverlap(a, b)`: file-level Jaccard when concrete files are known; directory containment check; domain Jaccard as fallback
  - `deriveDirectories(files)`: extracts unique parent directories from file lists
- [x] `src/scheduler/types.ts` — `ScheduleDecision`, `ScheduledGroup`, `DispatchWave`, `DispatchPlan`, `SchedulerTicket`, `SchedulerConfig`, `DEFAULT_SCHEDULER_CONFIG`
- [x] `src/scheduler/index.ts` — `Scheduler` class
  - `plan(tickets, surfaces)`: produces a `DispatchPlan` with ordered waves
  - Union-find clustering: tickets with Jaccard ≥ mergeThreshold are merged into one job
  - Kahn's topological sort: groups with any overlap > sequenceThreshold land in later waves
  - `combinedSurface` on each group: union of all member tickets' impact surfaces
  - Decision labels: `parallel` (same wave, no overlap), `sequence` (later wave, some overlap), `merge` (one agent job)
- [x] 34 unit tests: 19 for impact, 15 for scheduler (all passing)
- [x] Total test count: 124

### M7 — Linear + provenance (done)

- [x] `src/integrations/linear/types.ts` — `LinearState`, `LinearLabel`, `LinearUser`, `LinearTicket`, `LinearWorkflowState`, `LinearIssueFilter`
- [x] `src/integrations/linear/index.ts` — `LinearClient` with injectable `FetchFn`
  - `getTicket(identifier)`: fetches a single issue by id or identifier; normalises `labels { nodes }` to a flat array
  - `updateTicketStatus(ticketId, stateId)`: issues `issueUpdate` mutation
  - `listTeamIssues(teamId, options)`: lists issues for a team with optional limit and filter
  - `getWorkflowStates(teamId)`: returns all workflow states for a team
- [x] `src/integrations/linear/sync.ts` — `TicketSyncer` class with injectable `SyncPool`
  - `syncTicket(ticket)`: upserts a single ticket to the `tickets` table
  - `syncTeamTickets(teamId, options)`: fetches all team issues and upserts each; returns `{ synced, errors }`
- [x] `src/provenance/types.ts` — `AUDIT_EVENT_TYPES` const array, `AuditEventType`, `AuditEvent`, `PersistedAuditEvent`, `ProvenanceQuery`
- [x] `src/provenance/index.ts` — `ProvenanceRecorder` class with injectable `ProvenancePool`
  - `record(event)`: inserts into `audit_log`, returns the new row id
  - `query(params)`: parameterised SELECT with optional `ticketId`, `agentId`, `eventType`, `since`, `limit` filters
  - `queryByTicket(ticketId, limit?)`, `queryByDispatch(dispatchId)`, `getTrail(ticketId)` — convenience read helpers
  - `createProvenanceRecorder(pool)` factory
- [x] 40 new unit tests (14 LinearClient + 8 TicketSyncer + 18 ProvenanceRecorder); total test count 252

### M6 — Gates (done)

- [x] `src/gates/types.ts` — `RiskLevel`, `DomainPolicy`, `GateStage`, `GateStatus`, `GateResult`, `GatePipelineInput`, `GatePipelineResult`, `ScopeCheckResult`, `CICheckFn`, `QACheckFn`, `ApprovalFn`
- [x] `src/gates/policy.ts` — `POLICY_TABLE` with low/medium/high risk entries for all known domains; `resolvePolicy(domains)` picks the strictest policy matching any of the input domains; falls back to `DEFAULT_POLICY` (medium risk) when no domain is recognised
- [x] `src/gates/scope.ts` — `ScopeChecker.check(expectedFiles, actualFiles, threshold)` computes drift ratio (unexpectedFiles / expectedFiles); passes when expectedFiles is empty (confidence too low) or drift ≤ threshold; failure reason includes file sample and ellipsis for long lists
- [x] `src/gates/pipeline.ts` — `GatePipeline.run(input)` runs stages in order: scope → CI → QA (if policy.requiresQA) → HITL (if policy.requiresHITL); short-circuits on first failure; stages without a configured runner are recorded as `'skipped'`; `createGatePipeline(options)` factory with injectable `checkCI`, `runQA`, `approve`
- [x] `src/gates/index.ts` — public re-exports
- [x] 37 unit tests covering policy resolution, scope drift logic, and all pipeline paths (all passing); total test count 212

### M5 — Hotspot leases (done)

- [x] `src/hotspots/types.ts` — `Hotspot`, `Lease`, `LeaseRequest`, `LeaseResult`, `HotspotCheckResult`, `ClockFn`
- [x] `src/hotspots/index.ts` — `HotspotLeaseManager` class
  - `register(hotspot)`: declares a new hotspot (replaces on duplicate name)
  - `check(files)`: returns `HotspotCheckResult` (touchesHotspot, matches) without acquiring a lease
  - `acquire(request)`: grants a lease (`'granted'`), blocks when another holder is active (`'blocked'`), or skips when no hotspot is matched (`'not-required'`); respects optional TTL
  - `release(leaseId)`: releases a lease by ID; returns true if found
  - `releaseByHolder(holderId)`: releases all leases held by a given dispatch/agent; returns count
  - `listActive()`: returns non-expired leases (prunes first)
  - `pruneExpired()`: removes expired leases, returns count removed
  - `matchesPattern(filePath, pattern)`: exported glob matcher supporting exact, directory-prefix (`/`), single-segment (`*`), and cross-segment (`**`) patterns; `**/` makes the directory prefix optional so root-level files are matched
- [x] `createHotspotLeaseManager(hotspots?, clock?)` factory with injectable clock for deterministic testing
- [x] 30 unit tests covering pattern matching, check, acquire, release, TTL/expiry, glob patterns, and the lock-free guarantee for non-hotspot files; total test count 175

### M4 — Semantic conflicts (done)

- [x] `src/integration/semantic/types.ts` — `BranchInput`, `TypeScriptError`, `BranchCheckResult`, `CrossBranchConflict`, `SemanticConflictReport`, `ExecFn`
- [x] `src/integration/semantic/index.ts` — `SemanticConflictDetector` class
  - `parseTscOutput(output)`: parses `tsc --noEmit` stdout into structured `TypeScriptError` objects via regex `path(line,col): error|warning TSxxxx: message`
  - `checkBranch(input)`: runs `npx tsc --noEmit` in the branch's worktree via injectable `ExecFn`; returns `BranchCheckResult` with `clean` flag, error list, and duration
  - `detect(branches)`: checks all branches in parallel, then cross-references results via `findCrossConflicts`
  - `checkPairConflict(A, B)`: detects semantic conflicts when (a) branch A has errors in files changed by B, (b) B has errors in files changed by A, or (c) both have errors in the same file; returns a `CrossBranchConflict` with deduplicated `filesInvolved` and a human-readable `description`
- [x] `createDefaultExec()` — default Node.js `child_process.exec` adapter; `|| true` in the shell command ensures stdout is always captured
- [x] `createSemanticConflictDetector(tsconfigPath?)` — factory with optional tsconfig override
- [x] 21 unit tests (all passing); total test count 145

### M1 — Worktrees + queue (done)

- [x] `src/integration/worktrees/` — `WorktreeManager` class
  - `create(options)`: `git worktree add -b <branch> <path> <base>`, returns `WorktreeInfo`
  - `remove(dispatchId)`: `git worktree remove --force <path>`
  - `prune()`: `git worktree prune`
  - `list()`: parses `git worktree list --porcelain`, filters to managed base
  - `parseWorktreeList()` exported for unit testing
  - `createWorktreeManager(git, repoRoot, worktreeBase?)` factory
- [x] `src/integration/queue/` — `GitHubMergeQueueAdapter` + `QueueAdapter` interface
  - `enqueue(prNumber, mergeMethod, dispatchId?)`: enables auto-merge via GraphQL (`enablePullRequestAutoMerge`)
  - `dequeue(prNumber)`: disables auto-merge via GraphQL
  - `getStatus(prNumber)`: returns local entry or falls back to GitHub REST
  - `listQueued()`: lists open PRs with `auto_merge` enabled
  - `updateStatus(prNumber, status)`: webhook-driven status updates
  - `OctokitLike` interface keeps the adapter testable without real GitHub credentials
- [x] 28 unit tests across both modules (13 worktrees + 15 queue), all passing
- [x] Total: 63 tests passing

### M8 — Releases (done)

- [x] `src/releases/types.ts` — `ReleaseStatus`, `ManifestTicket`, `ReleaseManifest`, `ReleaseRecord`, `CreateReleaseOptions`
- [x] `src/releases/index.ts` — `ReleaseManager` class with injectable `ReleasesPool` and `ReleaseLinearClient`
  - `create(version, options)`: INSERT into releases table; supports `branch`, `linearCycleId`, `freezeAt`; returns `ReleaseRecord`
  - `getRelease(releaseId)`: SELECT by id; returns `ReleaseRecord | null`
  - `updateStatus(releaseId, status)`: UPDATE status; automatically adds `released_at = NOW()` when status is `'released'`
  - `setFreezeWindow(releaseId, freezeAt)`: sets `freeze_at` and flips status to `'frozen'`
  - `isInFreezeWindow(releaseId, at?)`: returns `true` when `at >= freeze_at`; defaults `at` to now
  - `buildManifest(releaseId, linearClient, teamId, labelFilter?)`: fetches tickets from Linear, maps to `ManifestTicket[]`, computes `summary.byStatus` and `summary.byPriority`, persists manifest JSON to DB, returns `ReleaseManifest`
  - `generateNotes(manifest)`: pure function; categorises tickets by label into Features / Fixes / Improvements / Other sections; renders markdown links when ticket has a URL
  - `saveNotes(releaseId, notes)`: UPDATE notes column in DB
  - `listReleases(status?)`: SELECT all releases or filter by status, ordered by `created_at DESC`
- [x] `createReleaseManager(pool)` factory
- [x] 40 new unit tests; total test count 292

### M9 — Agent interface (done)

- [x] `src/agent-iface/schemas.ts` — zod schemas for every agent-facing command, shared by the CLI and MCP server so the two surfaces validate identically
- [x] `src/agent-iface/commands.ts` — one function per operation an agent needs to drive the loop:
  - `planSchedule` — wraps `ImpactEstimator` + `Scheduler` end to end
  - `checkHotspot`, `registerHotspot`, `acquireLease`, `releaseLease`, `releaseLeaseByHolder`, `listActiveLeases` — wrap `HotspotLeaseManager`; default to a process-wide singleton (`getHotspotManager`/`resetHotspotManager`) so leases persist across calls within one long-running MCP session, with an injectable `manager` param for tests and one-off use
  - `runGatePipeline` — wraps `GatePipeline`; the agent reports the CI status it observed (and optional QA/HITL results) instead of the pipeline calling back out to live infrastructure
  - `recordProvenance`, `queryProvenance` — wrap `ProvenanceRecorder`; injectable `pool`, defaults to `getPool(loadConfig().DATABASE_URL)`
  - `createRelease`, `listReleases`, `buildReleaseManifest`, `generateReleaseNotes` — wrap `ReleaseManager`; injectable `pool`/`linearClient`
- [x] `src/agent-iface/cli/index.ts` — single-shot CLI: `harbormaster <namespace> <action> '<json>'`, payload via positional arg or `--stdin`; `runCli(argv)` exported for testing without spawning a process; `--help` lists every command
- [x] `src/agent-iface/mcp/server.ts` + `mcp/index.ts` — MCP server (`@modelcontextprotocol/sdk`) over stdio; one `registerTool` per command using the shared zod shapes as the input schema; `createMcpServer()` exported for testing without a transport
- [x] `package.json` — `bin.harbormaster` (compiled CLI), `npm run cli` / `npm run mcp` (tsx, dev mode)
- [x] 26 new unit tests (17 commands + 6 CLI dispatch + 3 MCP tool registry); total test count 318

## Documentation

| # | Deliverable | Status |
|---|-------------|--------|
| a | Doc comments (TSDoc) across the public surface | ☑ Done |
| b | API reference documentation (CLI/MCP command surface) | ☑ Done |
| c | Architecture dossier (`docs/architecture.md`) | ☑ Done |
| d | Integration guide(s) (`docs/integration.md`) | ☐ Not started |
| e | Usage/how-to guides, `docs/` index, final README pass | ☐ Not started |

### a — Doc comments (done)

- [x] Added TSDoc (`/** ... */`) to every previously-undocumented exported
  class, function, and type across the public surface: `config.ts`, `db/`
  (`index.ts`, `migrate.ts`), `gates/index.ts`, `index.ts`,
  `integrations/github/` (`index.ts`, `webhooks.ts`), `integrations/linear/`
  (`index.ts`, `sync.ts`, `types.ts`), `provenance/` (`index.ts`,
  `types.ts`), `release/index.ts`, `release/semver.ts`, `releases/`
  (`index.ts`, `types.ts`), `agent-iface/mcp/index.ts`
- [x] Comments explain intent and non-obvious behaviour (singleton pool
  rationale, transaction-per-migration safety, why GitHub App init returns
  `null` instead of throwing, audit log immutability, freeze-window
  semantics) rather than restating signatures
- [x] `npm run build`, `npm run lint`, and the full test suite (318 tests)
  verified green after the change

### b — API reference (done)

- [x] `docs/api.md` — full reference for the agent-facing command surface
  (the only API harbormaster exposes: no HTTP server, just the CLI/MCP
  command layer in `src/agent-iface/`)
  - Conventions shared by both surfaces: CLI invocation/exit codes, MCP tool
    result shape, configuration env vars, error cases
  - All 14 commands (`schedule_plan`, 6 `hotspot_*`, `gate_run`, 2
    `provenance_*`, 4 `release_*`): request field tables with types and
    required/optional, response shape with a worked JSON example, and
    command-specific error notes
  - Domain risk policy table (which domains require QA/HITL and at what
    scope-drift threshold) reproduced alongside `gate_run` since the gate
    response depends on it
  - A worked end-to-end example chaining schedule → gate → provenance →
    release across four CLI calls
- [x] Fixed a pre-existing `npm run typecheck` failure surfaced while
  verifying this change: `ReleasesPool` was `Pick<Pool, 'query'>`, which
  pulls in `pg`'s fully overloaded `query` signature that the test mocks
  couldn't structurally satisfy. Narrowed it to a single-shape `query()`
  interface matching the `ProvenancePool`/`SyncPool` pattern used elsewhere
  in the codebase. `npm run typecheck` (part of CI) is green again.

### c — Architecture dossier (done)

- [x] `docs/architecture.md` — component map of every `src/` module, an
  ASCII data/control-flow diagram from Linear ticket through scheduler,
  worktrees, merge queue, rerun, gates, provenance, and release manifest
  generation, a table of key design decisions and trade-offs (schedule-
  against-impact vs. locking, wrap-not-build the merge queue, optimistic
  rerun with a capped retry, hotspot leases scoped to only the declared
  set, per-domain gate policy, dependency injection with a singleton
  exception for the long-running MCP process, tsc-reuse for semantic
  conflicts, release.sh as a port not a rewrite), an external-dependencies
  table, and a spec-section-to-code map
- [x] `npm run typecheck`, `npm run lint`, and the full test suite (318
  tests) verified green (docs-only change; no source touched)
