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
| QC | Best-in-class quality checklist — real (non-mocked) proof for each item | ◐ In progress (3 of 8 items proven end-to-end; see note below) |

**Note on QC status:** 335 tests pass, but a review against the spec's own "Best-in-class quality checklist" (spec.md) found that every milestone's tests originally ran entirely against mocked git/HTTP/DB/subprocess clients — none exercised a real git repo, so the checklist's own wording ("proven on a sample repo", "a genuine collision... caught... without human intervention") wasn't actually met anywhere. Closed so far:
  - Item 1 (headline test): `tests/e2e/headline-scheduling.e2e.test.ts` runs `ImpactEstimator` + `Scheduler` + `WorktreeManager` unmodified against a real throwaway git repository.
  - Item 2 (optimistic re-run): `tests/e2e/optimistic-rerun.e2e.test.ts` drives a genuine `git rebase` conflict (two branches editing the same line) through `Rebaser`, then `Rerunner.handleFailure` tears down the losing worktree and creates a real new one off the new tip, and the retried change rebases cleanly — no mocked git anywhere except the (intentionally thin, GitHub-API-backed) `QueueAdapter`, which this scenario never calls since no PR is involved.
  - Item 3 (semantic conflicts): `tests/e2e/semantic-conflict.e2e.test.ts` runs `SemanticConflictDetector` with its real `createDefaultExec` shell-out (not the fake `ExecFn`) against two genuine git worktrees of a sample repo. One branch widens a shared function's signature (`add(a, b)` → `add(a, b, c)`) without updating the other branch's call site; the real `npx tsc --noEmit` run in that worktree produces an actual `TS2554` arity error, which the cross-reference correctly attributes to the file the other branch is concurrently modifying.

  Outstanding, for future increments:
  - Items 5 and 7 (release lifecycle, provenance/manifest): real-git and real-Linear-shaped fixtures instead of mocked `SimpleGit`/`SyncPool`.
  - Item 8 (MCP): the test suite calls registered tool handlers directly rather than round-tripping through the MCP stdio/JSON-RPC transport.
  - Items 4 and 6 (hotspot leases, gate policy) are inherently in-memory logic and are already genuinely proven by their existing unit tests — no gap there.

### M0 — Scaffold (done)

- [x] Node 20 / TypeScript 5 project (package.json, tsconfig.json, tsconfig.build.json)
- [x] Directory layout matching spec: release/, db/, integrations/github/, integrations/linear/
- [x] Postgres schema + migration runner (`src/db/migrations/001_initial.sql`, `src/db/migrate.ts`)
  - audit_log, tickets, dispatches, gate_decisions, releases tables
- [x] GitHub App (`src/integrations/github/`)
  - App init via `@octokit/app`, webhook handlers (push, pull_request, check_suite,
    installation, installation_repositories)
  - HTTP webhook receiver actually mounted and listening (`server.ts`) — see
    the dedicated entry below
  - Real branch-protection enforcement, not just a log line — see below
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

### M0 follow-up — GitHub webhook receiver + real branch protection (done)

Closed a gap flagged during the documentation phase: `docs/integration.md`
had honestly disclosed that `src/index.ts` initialized the GitHub App in
memory but never started an HTTP listener, and that "enforces no direct
main pushes and required checks" (spec.md line 73) was not actually
implemented — the push handler only logged. This increment makes both real:

- [x] `src/integrations/github/server.ts` — `startWebhookServer(app, port, path?)`
  mounts `@octokit/webhooks`'s `createNodeMiddleware` on a real
  `http.createServer`, so GitHub's webhook deliveries reach the process
  instead of being registered on handlers nothing ever invokes
- [x] `src/integrations/github/branch-protection.ts` — `enforceBranchProtection`
  calls `PUT /repos/{owner}/{repo}/branches/{branch}/protection` (required
  status checks, required PR review, `enforce_admins`, no push restrictions
  bypass) — this is what actually backs "no direct main pushes and required
  checks"; a webhook handler can only observe a push after the fact, so
  enforcement has to be a standing GitHub-side repo setting
- [x] `src/integrations/github/webhooks.ts` — `registerWebhooks` now also
  listens for `installation.created` / `installation_repositories.added`
  and calls `enforceBranchProtection` automatically for every repo the App
  gains access to, using the installation-scoped Octokit `@octokit/app`
  already injects into the event; protection failures (e.g. missing
  Administration permission) log a warning instead of crashing the process
- [x] `src/index.ts` wires it end to end: `config.PORT` now actually has a
  listener on it, and `GITHUB_PROTECTED_BRANCH` / `GITHUB_REQUIRED_STATUS_CHECKS`
  (new config, `src/config.ts`) drive the enforced policy
- [x] `docs/integration.md` updated to describe the real behaviour instead
  of the deferral
- [x] 13 new unit tests (4 branch-protection, 7 webhooks, 2 server —
  including a real HTTP round trip against a mocked webhook middleware);
  total test count 331
- [x] `npm run typecheck`, `npm run lint`, and `npm run build` verified green

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

### QC — Headline test proven against a real sample repo (done)

- [x] `tests/e2e/headline-scheduling.e2e.test.ts` — a real, throwaway git repository
  (created with `simple-git` under a temp directory, not mocked) stands in for the
  spec's "sample repo". `ImpactEstimator` and `Scheduler` run unmodified against it:
  - Two tickets sharing a file (`src/shared/utils.ts`) are scheduled into different
    waves (`sequence`), never the same wave.
  - Two tickets touching the identical file are clustered into one `merge` group,
    i.e. dispatched as a single agent job rather than two.
  - A ticket touching an unrelated file lands in the same wave as a non-overlapping
    ticket, proving the scheduler doesn't over-serialize independent work.
  - A second test walks the resulting `DispatchPlan` wave-by-wave and creates a real
    `git worktree` per group via `WorktreeManager` against the sample repo (waves
    run concurrently within themselves, sequentially across themselves), then
    asserts the two overlapping tickets' worktrees were never created in the same
    wave — the headline guarantee, demonstrated with real git operations rather
    than asserting on in-memory scheduler output alone.
- [x] 2 new tests; total test count 320
- [x] Identified (but did not yet close) the same real-git/real-subprocess gap in
  the optimistic re-run, semantic-conflict, release-lifecycle, provenance, and MCP
  transport tests — see the QC note above the milestone table for what's left.

### QC — Optimistic re-run proven against a real rebase conflict (done)

- [x] `tests/e2e/optimistic-rerun.e2e.test.ts` — against the same kind of real,
  throwaway git repository: two branches independently edit the same line of
  `src/payments/charge.ts` (one committed straight to `main`, simulating a
  change that landed first). `Rebaser.rebase` runs a genuine `git rebase` and
  hits a real conflict; the worktree is confirmed left clean (no `<<<<<<<`
  markers) after the automatic abort. `Rerunner.handleFailure` then tears down
  the losing worktree via the real `WorktreeManager`, resolves the actual new
  tip SHA of `main` (asserted against `git rev-parse main` directly, not an
  assumption), and creates a fresh worktree off it. The agent's retried change
  is written as a genuinely non-colliding edit against the *current* file
  content (not scripted around the conflict), and a second real `git rebase`
  lands it cleanly — the final file contains both the original collision
  winner's edit and the retry's edit, proving nothing was lost.
- [x] The only non-real piece is `QueueAdapter` (GitHub's merge-queue API,
  intentionally wrapped rather than reimplemented per the spec's build-vs-buy
  section); this scenario passes no `prNumber`, so it's never invoked.
- [x] 1 new test; total test count 334

### QC — Semantic conflict detection proven against a real `tsc` signature break (done)

- [x] `tests/e2e/semantic-conflict.e2e.test.ts` — against a real, throwaway
  sample repo with two genuine git worktrees (`WorktreeManager`, not mocked):
  branch A widens a shared `add(a, b)` function to a required third
  parameter (`add(a, b, c)`) but never touches the file that calls it;
  branch B is concurrently editing that caller for an unrelated reason and
  never sees branch A's change. `SemanticConflictDetector.detect` runs its
  real `createDefaultExec` shell-out — an actual `npx tsc --noEmit` per
  worktree, each discovering its own committed `tsconfig.json` the normal
  way tsc does (upward directory search, no path override) — and the
  real compiler reports a genuine `TS2554: Expected 3 arguments, but got 2`
  at the caller's file and line. The cross-reference correctly attributes
  branch A's real error to a file branch B is modifying, flagging it as a
  cross-branch conflict; branch B's own worktree (unaware of the signature
  change) typechecks clean, proving the detector doesn't false-positive on
  the branch that didn't cause the break.
- [x] 1 new test; total test count 335
- [x] `npm run typecheck`, `npm run lint`, and `npm run build` verified green

## Documentation

| # | Deliverable | Status |
|---|-------------|--------|
| a | Doc comments (TSDoc) across the public surface | ☑ Done |
| b | API reference documentation (CLI/MCP command surface) | ☑ Done |
| c | Architecture dossier (`docs/architecture.md`) | ☑ Done |
| d | Integration guide(s) (`docs/integration.md`) | ☑ Done |
| e | Usage/how-to guides, `docs/` index, final README pass | ☑ Done |

### e — How-to guides, docs index, final README pass (done)

- [x] `docs/how-to.md` — task-oriented recipes, each a copy-pasteable CLI
  sequence verified against the current build (ran every example live,
  including against a real local Postgres for the provenance/release
  recipes): the headline scheduler demo (parallel/sequence/merge, tied back
  to the spec's headline test), declaring a hotspot and taking/blocking/
  releasing an advisory lease (with the single-process caveat spelled out,
  since the CLI can't demonstrate it — each invocation is a fresh process),
  running the gate pipeline against both a medium- and high-risk domain,
  recording and querying provenance, and running a release end to end
  (create → list → notes). Closes with a troubleshooting table for the
  errors someone hits first (`DATABASE_URL` unset, migrations not applied,
  the hotspot-across-CLI-calls gotcha, schema validation errors, HITL gate
  stopping the pipeline)
- [x] `docs/README.md` — docs index: a table of what each doc is for and
  when to read it, plus role-based reading-order guidance (new to the
  project / integrating an agent / just need one command)
- [x] Final `README.md` pass: added `docs/how-to.md` to the documentation
  links, replaced the per-module deep-dive code examples (worktrees, queue
  adapter, scheduler, gates, releases, agent interface) — now duplicated by
  `docs/how-to.md`, `docs/api.md`, and `docs/integration.md` — with a
  compact "Modules at a glance" table and a "Where to go next" section that
  routes by task, so the README orients a newcomer in one screen instead of
  re-deriving reference material the docs already own
- [x] `npm run typecheck`, `npm run lint`, `npm run build`, and the full
  test suite (318 tests) verified green (docs-only change; no source
  touched)

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

### d — Integration guide (done)

- [x] `docs/integration.md` — how to stand harbormaster up and call it from
  another system, in four sections plus a worked flow:
  - Running the control plane: Postgres setup, the config table (env vars
    and what happens when each is unset), applying migrations, booting
  - Driving it as an agent: CLI (spawn-per-call) vs. MCP (long-running
    subprocess, with a Claude Code/Cursor-style `mcpServers` config
    snippet) vs. calling `agent-iface/commands.ts` directly in-process,
    including the MCP-only in-memory hotspot manager caveat
  - GitHub integration: creating the App (permissions, events, secrets),
    an accurate note that `src/index.ts` initializes the App but does not
    yet mount an HTTP webhook receiver, a concrete `createNodeMiddleware`
    snippet to wire one up, and using `GitHubMergeQueueAdapter` against a
    real Octokit installation client
  - Linear integration: getting an API key, `TicketSyncer.syncTeamTickets`
    to populate the `tickets` table, and `ReleaseManager.buildManifest` /
    `generateNotes` for release notes
  - An end-to-end worked flow chaining `schedule plan` → merge queue →
    `gate run` → `provenance record` → `release create`/`release manifest`
    with corrected CLI command names (`schedule plan`, not `schedule_plan`)
    and valid payload fields cross-checked against `src/agent-iface/schemas.ts`
- [x] `docs/images/cli-schedule-plan.png` — a real terminal screenshot of
  `schedule plan` producing a two-ticket dispatch plan, captured with
  `freeze` and embedded in the CLI section
- [x] `npm run typecheck`, `npm run lint`, `npm run build`, and the full
  test suite (318 tests) verified green (docs-only change; no source touched)

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
