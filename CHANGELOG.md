# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Added — 2026-06-30 (M9)

- M9 agent interface: CLI (`src/agent-iface/cli/`) exposes all harbormaster operations — `schedule`, `impact`, `lease acquire/release`, `trail`, `status`, `help` — via a minimal argv parser and injectable runner; `runCommand(cmd, deps)` returns a typed `CliResult<T>` so callers can format output or pipe data without parsing stdout
- MCP server (`src/agent-iface/mcp/`) implements JSON-RPC 2.0 over newline-delimited stdio, giving AI agents six typed tools: `hm_schedule` (conflict-aware dispatch plan), `hm_estimate_impact` (impact surface), `hm_check_hotspot` (hotspot detection without lease), `hm_acquire_lease` (advisory lease — returns granted/blocked/not-required), `hm_release_lease` (release after work), and `hm_get_trail` (provenance audit trail); all tools return structured JSON text content so model outputs can be parsed directly; `McpServer.handle(line)` is fully testable without real IO
- 50 new unit tests (29 CLI, 21 MCP); total test count 342

### Added — 2026-06-30 (M8)

- M8 releases: `ReleaseManager` (`src/releases/`) manages Linear-planned releases end-to-end — `create` inserts a release record (version, branch, optional `linearCycleId` and `freezeAt`); `buildManifest` fetches tickets from Linear via injectable `ReleaseLinearClient`, maps them to `ManifestTicket[]`, computes summary counts by status and priority, and persists the manifest to the `releases` table; `generateNotes` is a pure function that categories tickets by label into Features / Fixes / Improvements / Other sections and renders markdown links when a ticket has a URL; `setFreezeWindow` sets `freeze_at` and flips status to `'frozen'`; `isInFreezeWindow` compares the current time to `freeze_at`; `updateStatus` stamps `released_at = NOW()` when status reaches `'released'`; `listReleases` supports optional status filtering ordered by `created_at DESC`; all database and Linear dependencies are injected for deterministic testing
- 40 new unit tests; total test count 292

### Added — 2026-06-30 (M7)

- M7 Linear + provenance: `LinearClient` (`src/integrations/linear/`) implements the full Linear GraphQL API — `getTicket`, `updateTicketStatus`, `listTeamIssues`, and `getWorkflowStates` — with an injectable `FetchFn` for deterministic testing; labels are normalised from GraphQL connection shape (`{ nodes: [] }`) to a flat array
- `TicketSyncer` (`src/integrations/linear/sync.ts`) upserts Linear tickets into the `tickets` Postgres table via `syncTicket` (single upsert) and `syncTeamTickets` (full team sweep, returns `{ synced, errors }`); a `SyncPool` interface keeps it testable without a real database
- `ProvenanceRecorder` (`src/provenance/`) writes every fleet event to the immutable `audit_log` table via `record(event)` (returns the new row id); `query(params)` builds parameterised SQL from optional filters (`ticketId`, `agentId`, `eventType`, `since`, `limit`); convenience helpers `queryByTicket`, `queryByDispatch`, and `getTrail` cover the common read patterns; 16 audit event types defined as a typed union (`AuditEventType`)
- 40 new unit tests (14 LinearClient + 8 TicketSyncer + 18 ProvenanceRecorder); total test count 252

### Added — 2026-06-30 (M6)

- M6 gate pipeline: `GatePipeline` (`src/gates/`) runs changes through four ordered stages — scope check, CI, QA, and HITL approval — with per-domain policy controlling which stages are required and how strict they are
- `ScopeChecker` computes a drift ratio (unexpected files / expected files) against a per-policy threshold; low-confidence estimates (empty expected-file list) bypass the check automatically
- `resolvePolicy(domains)` selects the strictest matching `DomainPolicy` from a built-in table — low risk (`docs`, `readme`): scope + CI only; medium risk (`release`, `integration/*`, `scheduler`, etc.): + QA; high risk (`db`, `hotspots`, `provenance`): + mandatory HITL with a tighter 20 % scope threshold; unknown domains fall back to the default medium-risk policy
- Stages without a configured runner (`runQA`, `approve`) are recorded as `'skipped'` rather than failing, so the pipeline can run in environments where those functions aren't wired up yet
- All injectable function types (`CICheckFn`, `QACheckFn`, `ApprovalFn`) keep the pipeline fully testable without real infrastructure
- 37 new unit tests covering policy resolution, scope drift boundary conditions, and every pipeline path (low/medium/high risk, scope fail, CI fail, QA fail, HITL reject, skipped stages); total test count 212

### Added — 2026-06-30 (M5)

- M5 hotspot leases: `HotspotLeaseManager` (`src/hotspots/`) enforces advisory leases on declared hotspots — files or directories that are too costly to re-work after a collision (database migrations, shared API contracts, etc.); `register` declares a hotspot with glob patterns and a reason; `check` detects overlaps without acquiring a lock; `acquire` grants the lease when free, returns `'blocked'` with the holder's lease when taken, or `'not-required'` when the files touch no hotspot; `release` and `releaseByHolder` free leases; `listActive` / `pruneExpired` manage TTL-based expiry; `matchesPattern` supports exact, directory-prefix (`/`), single-segment (`*`), and cross-segment (`**`) glob patterns; the rest of the repo remains entirely lock-free
- 30 new unit tests; total test count 175

### Added — 2026-06-30 (M4)

- M4 semantic conflict detection: `SemanticConflictDetector` (`src/integration/semantic/`) runs `tsc --noEmit` in each in-flight branch's worktree via an injectable `ExecFn`; `parseTscOutput` converts raw tsc stdout into structured `TypeScriptError` objects; `detect` checks branches in parallel and calls `checkPairConflict` for every pair — flagging conflicts when branch A has type errors in files that branch B modified, when B has errors in A's files, or when both error in the same file; reports a `SemanticConflictReport` with per-branch results, `CrossBranchConflict` entries (with deduplicated `filesInvolved` and a human-readable description), and a top-level `hasConflicts` flag
- 21 new unit tests covering parser edge cases, branch-level checks, and all cross-conflict detection scenarios; total test count 145

### Added — 2026-06-30 (M3)

- M3 impact + scheduler: `ImpactEstimator` (`src/impact/`) estimates a ticket's file/directory/domain impact surface from explicit file lists (confidence 1.0), label mappings (0.6), or title/description keywords (0.3); `jaccardSimilarity` and `computeOverlap` measure surface overlap (file Jaccard → directory containment → domain Jaccard)
- `Scheduler` (`src/scheduler/`) takes tickets + impact surfaces and produces a `DispatchPlan`: union-find clusters tickets with Jaccard ≥ mergeThreshold into merged jobs, Kahn's topological sort places overlapping groups in later waves, and non-overlapping groups share the same wave; decision labels are `parallel`, `sequence`, or `merge`
- 34 new unit tests (19 impact + 15 scheduler); total test count 124

### Added — 2026-06-30 (M2)

- M2 optimistic re-run: `Rebaser` (`src/integration/rerun/rebase.ts`) rebases a worktree branch onto a new tip via a per-directory `GitFactory`; on conflict it collects unmerged files via `git diff --name-only --diff-filter=U` and aborts to restore a clean state; on success it returns the new HEAD SHA
- `CIChecker` (`src/integration/rerun/ci.ts`) queries GitHub check runs for a ref and aggregates to `success | failure | pending | unknown`; neutral/skipped conclusions pass, timed_out/cancelled/action_required fail
- `Rerunner` (`src/integration/rerun/index.ts`) orchestrates the re-dispatch loop: guards with `shouldRetry`, tears down the failing worktree via `cleanup`, resolves the current tip of the base branch, calls a `RedispatchFn` callback for new identifiers, then creates a fresh worktree ready for the agent to re-run; returns `{ exhausted: true }` when the attempt limit is reached
- 27 new unit tests (8 file test total, 90 tests total)

### Added — 2026-06-30 (M1)

- M1 worktrees + queue: `WorktreeManager` (`src/integration/worktrees/`) creates isolated git worktrees per dispatch using `git worktree add -b`, with `remove`, `prune`, and `list` (parsing `--porcelain` output); factory `createWorktreeManager` provides a default `.worktrees/` base
- `GitHubMergeQueueAdapter` (`src/integration/queue/`) wraps GitHub's native merge queue: `enqueue` enables auto-merge via `enablePullRequestAutoMerge` (GraphQL), `dequeue` disables it, `getStatus` checks local state before falling back to REST, `listQueued` filters open PRs by `auto_merge`, and `updateStatus` handles webhook-driven transitions; `QueueAdapter` interface makes the adapter swappable
- 28 new unit tests (13 worktrees + 15 queue); total test count 63

### Added — 2026-06-29

- M0 scaffold: Node 20 / TypeScript 5 project with `tsconfig.json`, `tsconfig.build.json`, ESLint 9 flat config, and Vitest test runner
- Postgres schema (`src/db/migrations/001_initial.sql`): `audit_log`, `tickets`, `dispatches`, `gate_decisions`, `releases` tables; migration runner at `src/db/migrate.ts`
- GitHub App skeleton (`src/integrations/github/`): app initialisation via `@octokit/app`, webhook handlers for push (direct-main enforcement), pull_request.closed, and check_suite.completed
- Linear API client stub (`src/integrations/linear/`) for the M7 milestone
- Release lifecycle port from `release.sh` (`src/release/`): semver bump from latest tag, `createReleaseBranch`, `autoNextRelease`, `tagMain` with tag-exists and has_post_release_run idempotency guards, `hotfixStart`/`hotfixFinish` with fan-out to main/develop/release branches, `syncDevelop` with package.json conflict auto-resolve, and feature branch naming convention (`<type>/<ticketId>/<slug>`)
- 35 unit tests covering the full release module (all green)
- GitHub Actions CI workflow: typecheck → lint → build → test with Postgres service container
