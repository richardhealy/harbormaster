# Architecture

harbormaster is a coordination layer for a fleet of AI coding agents working
against one repository. It does not run agents and it does not implement a
merge queue or a CI system — it schedules work so agents rarely collide,
wraps an existing merge queue so the rare collision is cheap to absorb, and
records everything against a Linear ticket so a release manager can trust
the result. This document maps the pieces, how data and control flow through
them, the trade-offs behind the design, and where each part of `spec.md`
lands in the code.

## Component map

```
harbormaster/
  scheduler/         impact-aware dispatch planning (parallel / sequence / merge)
  impact/            impact-surface estimation + Jaccard overlap scoring
  integration/
    worktrees/       per-dispatch git worktree lifecycle
    queue/            adapter over GitHub's native merge queue
    semantic/         cross-branch TypeScript typecheck conflict detection
    rerun/             optimistic-integration retry loop (rebase, CI check, redispatch)
  hotspots/          advisory leases for the declared un-mergeable set
  gates/             scope / CI / QA / HITL pipeline, per-domain policy
  provenance/        append-only audit log
  releases/          Linear-planned releases: manifests, notes, freeze windows
  release/           ported release.sh lifecycle: semver, branches, tags, hotfix, sync
  integrations/
    github/          GitHub App init + webhook handlers
    linear/          Linear GraphQL client + ticket→DB sync
  agent-iface/
    commands.ts      one function per agent-facing operation
    cli/              single-shot CLI over commands.ts
    mcp/              MCP server (stdio) over the same commands.ts
  db/                Postgres pool, migration runner, schema types
  config.ts          env schema (zod), shared by every entry point
  index.ts           control-plane process: DB check + GitHub App boot
```

Each top-level directory under `src/` is a self-contained module: it exports
a class or a small set of functions, takes its external dependencies
(Postgres pool, git client, Octokit, `fetch`, a clock) as constructor
arguments or factory parameters, and is unit-tested against fakes of those
dependencies rather than live infrastructure. No module reaches into
another's internals — `scheduler` depends on `impact`'s exported
`ImpactSurface` type and `computeOverlap` function, `agent-iface/commands.ts`
composes all of the above, and nothing depends on `agent-iface`. That
one-directional dependency graph is what lets `commands.ts` be a thin
composition layer instead of a place where behavior forks between the CLI
and MCP surfaces.

## Data and control flow

```
 Linear                                 GitHub
   │  tickets                              │  PRs / webhooks
   ▼                                       │
integrations/linear ──sync──▶ tickets table │
   │                                        │
   ▼                                        │
impact.estimate()  ──▶ ImpactSurface[]      │
   │                                        │
   ▼                                        │
scheduler.plan()   ──▶ DispatchPlan (waves of parallel/sequence/merge groups)
   │                                        │
   ▼                                        │
 [agent picks up a group from a wave]       │
   │                                        │
   ▼                                        │
hotspots.acquire() ── granted/blocked/not-required (only for declared hotspot paths)
   │                                        │
   ▼                                        │
worktrees.create() ──▶ isolated git worktree + branch off current tip
   │                                        │
   │   [agent does the work in the worktree, opens a PR]
   ▼                                        ▼
queue.enqueue()    ──────────────▶  GitHub merge queue takes over:
   │                                  rebase → CI-on-merged-result → merge
   │                                        │
   │              ┌── green ───────────────┘
   │              │
   │              └── red / rebase conflict
   │                     │
   │                     ▼
   │              rerun.handleFailure() ── cleanup worktree, dequeue PR,
   │                                        resolve new tip, redispatch
   ▼
gates.run()  ──▶ scope → CI → QA → HITL (per-domain policy)   [pre-merge or pre-release gate]
   │
   ▼
provenance.record()  ──▶ audit_log (immutable: dispatch, gate decision, merge, release)
   │
   ▼
releases.buildManifest() / generateNotes()  ──▶ release manifest + notes from Linear tickets
```

Two things are deliberately *not* shown as a synchronous call chain because
they aren't one in the implementation:

- **Semantic conflict detection** (`integration/semantic`) runs
  independently, across whatever branches are currently in flight — it
  typechecks each branch's worktree and cross-references the errors against
  the files the *other* branches touched. It's a parallel check the queue's
  CI-on-merged-result step already approximates; making it explicit here
  catches the case where two branches individually typecheck but the union
  doesn't.
- **The gate pipeline** doesn't only run right before a GitHub merge. It's
  exposed to agents directly through `agent-iface` (`gate_run`) so a
  dispatcher can gate a change against policy before ever opening a PR,
  independent of whatever the merge queue's own required checks enforce.

## Key design decisions and trade-offs

**Schedule against impact instead of locking areas.** The spec's core bet
(see `spec.md`, "The reframe") is that redo is cheap for an agent, so a lock
that blocks a cheap worker to avoid a cheap loss is optimizing for the wrong
cost. `scheduler/` implements that directly: `impact/` estimates which files
a ticket will touch (from explicit `expectedFiles`, ticket labels, or
title/description keywords, in decreasing order of confidence — 1.0 / 0.6 /
0.3), and `Scheduler.plan()` turns pairwise overlap scores into three
outcomes: below `sequenceThreshold` → run in parallel (different waves are
unnecessary), between `sequenceThreshold` and `mergeThreshold` → sequence
into a later wave, at or above `mergeThreshold` → union-find the tickets
into a single merged job so one agent does both instead of two agents
producing a guaranteed conflict. The trade-off: this is a heuristic over
declared/inferred file sets, not a real dependency-graph analysis (the spec
notes `spelunk` is where deeper static analysis would plug in) — it will
sometimes sequence tickets that wouldn't have actually collided, trading a
little parallelism for a lot fewer redos.

**Wrap the merge queue, don't build one.** `integration/queue` is a ~150-line
adapter (`GitHubMergeQueueAdapter`) over GitHub's native `enablePullRequestAutoMerge`
GraphQL mutation, not a queue implementation. Per "Build vs buy" in the spec,
serialize-rebase-CI is undifferentiated and already solved well by GitHub/
Mergify/Graphite; the adapter exists only so the rest of harbormaster can
depend on a small `QueueAdapter` interface instead of GitHub's API shape
directly, which is also what makes `Rerunner` testable against a fake queue.

**Optimistic integration, not pessimistic locking, for the collision path.**
`integration/rerun` assumes most dispatches succeed and treats failure
(rebase conflict or red CI) as the exceptional path: `Rerunner.handleFailure`
tears down the losing worktree, dequeues its PR, resolves the *new* tip of
the base branch, and calls an injected `redispatch` callback to get fresh
identifiers before creating a new worktree there. `shouldRetry` caps this at
`DEFAULT_MAX_ATTEMPTS = 3` so a genuinely broken ticket fails loud instead of
looping forever — the one place this subsystem intentionally gives up rather
than keep absorbing cost.

**Advisory leases exist only for the declared 5%.** `hotspots/` is a
separate, much smaller mechanism from the scheduler: `HotspotLeaseManager`
holds no state about ordinary files at all — `acquire()` returns
`'not-required'` immediately unless the changed files match a hotspot
pattern that was explicitly `register()`-ed (a migration directory, a shared
contract file). This keeps the lock-free guarantee for the rest of the repo
literally true in the code, not just in policy: there's no path through
`acquire()` that can block on an unregistered path.

**Policy varies by domain risk, not by change size.** `gates/policy.ts`
resolves the *strictest* matching policy across a change's domains (a change
touching both `docs` and `db` gets the `db` policy), so a small change to a
high-risk area doesn't slip through on volume. `GatePipeline.run` then
short-circuits on the first failing stage — scope check, then CI, then QA
(only if `requiresQA`), then HITL (only if `requiresHITL`) — so a docs-only
change with `requiresQA: false, requiresHITL: false` clears in two stages
while a migration always stops for a human, which is the spec's "formalizes
the script's `merge-approved` step into policy."

**Dependency injection over module-level singletons, except at the process
boundary.** Every class that touches an external system (`ReleasesPool`,
`ProvenancePool`, `SyncPool`, `SimpleGit`, `OctokitLike`, `ExecFn`, `FetchFn`,
`ClockFn`) takes it as a constructor argument, narrowed to only the methods
that class actually calls (see `ReleasesPool`/`ProvenancePool` — a
one-method `query()` shape, not the full `pg.Pool` surface) rather than the
concrete library type. That's what makes the ~318 unit tests run without a
database, git repository, or network access. The one deliberate exception is
`agent-iface/commands.ts`, which defaults each command to a process-wide
singleton (`getPool(loadConfig().DATABASE_URL)`, a module-level hotspot
manager) *when no dependency is passed in* — an MCP server is a long-running
process serving one agent session, and leases or a DB pool need to persist
across tool calls within that session, not be reconstructed per call.

**Semantic conflict detection reuses the type checker instead of a custom
analyzer.** `integration/semantic` shells out to `npx tsc --noEmit` per
branch worktree (via an injectable `ExecFn` so tests never spawn a real
process) and parses its stdout with one regex
(`path(line,col): error|warning TSxxxx: message`). A conflict is flagged
when branch A's errors land in files branch B changed, or vice versa, or
both branches error in the same file. This is deliberately reuse over
reinvention — TypeScript's checker is already a whole-program analysis; the
value harbormaster adds is only the cross-referencing step the compiler
itself doesn't do (it only ever sees one branch at a time).

**The release lifecycle is a port, not a rewrite.** `release/` mirrors
`release.sh`'s functions one-to-one (`semver.ts`, `branch.ts`, `tags.ts`,
`hotfix.ts`, `sync.ts`) including its idempotency guards (tag-exists checks
before `tagMain`, `has_post_release_run`), per the spec's explicit "keep"
list. The only thing that changes is what used to be the script's manual
`merge` / `merge-approved` step — spec.md is explicit that this is "the
single change that takes the script from one-human-at-a-time to a
coordinated fleet," and that step is now `integration/queue` +
`integration/rerun` + `gates/`, not a rewritten piece of `release/` itself.

## External dependencies

| Dependency | Used by | Role |
|---|---|---|
| PostgreSQL (`pg`) | `db/`, `provenance/`, `releases/`, `integrations/linear/sync.ts`, `agent-iface` singletons | State + immutable audit log: `tickets`, `dispatches`, `gate_decisions`, `releases`, `audit_log` (schema: `src/db/migrations/001_initial.sql`) |
| GitHub App (`@octokit/app`) | `integrations/github/`, `integration/queue/` | Webhook receipt (push/PR/check_suite), and the `OctokitLike` REST/GraphQL surface the queue adapter drives |
| GitHub merge queue (via `enablePullRequestAutoMerge`) | `integration/queue/` | The actual rebase-CI-merge serialization; harbormaster only enqueues/dequeues/reads status |
| Linear GraphQL API | `integrations/linear/` | Ticket source of truth: fetch, status update, team listing, workflow states |
| `simple-git` | `integration/worktrees/`, `integration/rerun/` | Local git operations: `worktree add/remove/prune`, `rev-parse`, rebase |
| TypeScript compiler (`tsc`, shelled out) | `integration/semantic/` | Cross-branch typecheck for semantic-conflict detection |
| `zod` | `config.ts`, `agent-iface/schemas.ts` | Env validation and the single schema set shared by the CLI and MCP surfaces |
| `@modelcontextprotocol/sdk` | `agent-iface/mcp/` | MCP server transport (stdio) exposing `commands.ts` as tools |

## Where the spec lives in the code

| Spec section | Code |
|---|---|
| Conflict-aware scheduler | `src/scheduler/`, `src/impact/` |
| Optimistic integration (worktrees, queue, rerun) | `src/integration/worktrees/`, `src/integration/queue/`, `src/integration/rerun/` |
| Semantic-conflict detection | `src/integration/semantic/` |
| Hotspot advisory leases | `src/hotspots/` |
| Release lifecycle (ported from `release.sh`) | `src/release/` |
| Gate pipeline (scope / CI / QA / HITL) | `src/gates/` |
| Provenance / immutable audit log | `src/provenance/`, `audit_log` table |
| Release planning from Linear | `src/releases/`, `src/integrations/linear/` |
| Agent interface (CLI + MCP) | `src/agent-iface/` |
| GitHub App (no direct main pushes, required checks) | `src/integrations/github/` |

Every row in the "Best-in-class quality checklist" and "Milestones & status"
tables in `spec.md` maps to one of the modules above; `PROGRESS.md` tracks
which are done and links each to its test file under `tests/`.
