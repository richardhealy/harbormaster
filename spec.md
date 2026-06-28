# harbormaster — Implementation & Status Plan (v2, schedule-first)

**Stack:** Node / TypeScript. A control-plane service, an agent-facing CLI and MCP server, a GitHub App, Linear integration, Postgres for state and the audit log, git worktrees for isolation, and a wrapped merge queue (GitHub merge queue or Mergify). Ports the release lifecycle from the existing `ggsa-spt` `release.sh`.
**One-liner:** A coordination layer for a fleet of AI coding agents on one repo. It schedules work so agents rarely collide, integrates optimistically through a merge queue so the rare collision is cheap, and runs the whole thing under ticketed, on-the-record release management.
**The single problem it isolates:** Safe concurrency for autonomous coding agents, solved at the planning and integration layers rather than by locking the editor.

---

## The reframe (why v2 drops locking as the primary mechanism)

The first instinct is to lock: an agent leases an area, others wait. But locks exist to prevent *wasted work*, and that calculus assumes redo is expensive. For an agent, redo costs minutes and pennies. So pessimistic leasing optimizes for the wrong cost: it blocks cheap workers to avoid a cheap loss, and it never catches the conflicts that actually hurt (a signature change in one folder breaking a caller in another, which no area lock sees).

So harbormaster inverts it. Prevent collisions where it's free (at planning time), absorb them where they're cheap (at integration time), and lock only the genuinely un-mergeable spots.

Three layers, in order of importance:

1. **Schedule against impact (the primary mechanism).** Before dispatching tickets, estimate each one's impact surface from the dependency graph and static analysis (this is where `spelunk` earns its place). Run non-overlapping tickets in parallel, sequence the ones that overlap, and when two tickets clearly hit the same code, hand them to one agent as a single job instead of pretending they're independent. Most collisions never happen because the work was never dispatched concurrently. This is a scheduler, not a lock manager, and it's the novel, portfolio-worthy part.
2. **Integrate optimistically through a merge queue.** Every agent works in its own worktree off the current tip. Integration serializes: rebase onto the latest tip, run CI on the merged result, merge on green. A real conflict shows up as a failed rebase or red CI, and the losing agent re-runs against the new tip. You serialize the cheap step and parallelize the expensive one.
3. **Advisory leases for hotspots only (the 5%).** A few places genuinely punish collide-then-redo: a database migration, one giant shared file everything imports, an interface contract. Those get an advisory lock. That's the exception, not the architecture.

And one thing locks never do: **semantic-conflict detection.** Typecheck and build across the union of in-flight branches, so a change that breaks another branch's caller is caught before either merges. CI-on-the-merged-result already approximates this; making it explicit is strictly more useful than any area lock.

---

## Build vs buy

Don't build the merge queue. GitHub merge queue, Mergify, and Graphite already do serialize-rebase-CI well, and rebuilding it is undifferentiated. harbormaster *wraps* one. What it builds, and what makes it worth building, is the conflict-aware scheduler, the impact analysis, the agent provenance, the gate policy, and the Linear release planning.

---

## Release lifecycle (ported from `release.sh`)

The existing `ggsa-spt` script is the release-management core, and most of it ports directly:

**Keep (port to the service, add a real Linear API where it was name-only):**
- Semver bump from the latest tag, package.json version update.
- `create-branch` (release branch off main), `auto-next-release`, `tag-main` with its idempotency guards (`has_post_release_run`, tag-exists checks).
- `hotfix-start` / `hotfix-finish` and the fan-out to main, develop, and active release branches.
- `sync-develop` with the package.json conflict auto-resolve.
- The feature naming convention (conventional-commit type prefixes plus ticket id).

**Replace (this is the agent upgrade):**
- The manual `merge` / `merge-approved` path ("resolve conflicts manually, then continue") becomes the scheduler plus optimistic merge queue. This is the single change that takes the script from one-human-at-a-time to a coordinated fleet.
- Name-only Jira ids become real Linear integration: status sync, release planning, and provenance.

**Branch-model note:** keep the human-facing release and hotfix cadence the script defines, but have agents work on *short-lived* task branches off the active release branch, integrated via the queue, not long-lived branches. Long-lived `develop` plus `release/*` branches multiply the surface agents collide on, so the agent layer should not inherit that. Keep agent branches small and short.

---

## The gate pipeline

Each change clears configurable stages before merge, policy per domain risk:

1. **Scope check** — the diff matches the ticket's expected impact surface; large drift is flagged.
2. **CI on the merged result** — green on the rebased tip, not the stale branch (this is also the semantic-conflict catch).
3. **QA gate** — automated checks or eval, and/or a sign-off, for domains that need it.
4. **HITL approval** — a human approves; required for high-risk domains, optional for low-risk (a docs area auto-merges on green; a migration always stops for a human). This formalizes the script's `merge-approved` step into policy.

---

## Scope

**In:**
- A **conflict-aware scheduler**: impact estimation per ticket, parallel/sequence/merge decisions, dispatch plan.
- **Optimistic integration** wrapping a merge queue: worktrees, rebase, CI-on-result, automatic re-run of the losing change.
- **Semantic-conflict detection** across in-flight branches.
- **Hotspot advisory leases** for a small declared set (migrations, shared contracts).
- The **release lifecycle** ported from `release.sh`, plus real Linear integration.
- A **gate pipeline** (scope, CI, QA, HITL) with per-domain policy.
- **Provenance**: every dispatch, branch, gate decision, and merge tied to a Linear ticket in an immutable audit log.
- **Release planning** from Linear: manifests, notes, freeze windows.
- **Agent interface**: CLI plus MCP server.
- A **GitHub App** that enforces no direct main pushes and required checks.

**Explicitly out (for v1):**
- Running the agents (that is `conductor`, Claude Code, Cursor).
- Building a merge queue or a CI system from scratch (wrap existing ones).
- A git host.

---

## Architecture

```
harbormaster/
  scheduler/         # impact estimation, parallel/sequence/merge planning
  impact/            # dependency graph + static analysis (uses spelunk)
  integration/
    worktrees/       # per-task isolation off the current tip
    queue/           # adapter over GitHub merge queue / Mergify
    semantic/        # cross-branch typecheck/build conflict detection
    rerun/           # re-dispatch the losing change against the new tip
  hotspots/          # advisory leases for un-mergeable spots only
  release/           # ported release.sh lifecycle: branches, tags, hotfix, sync
  gates/             # scope / CI / QA / HITL, per-domain policy
  provenance/        # immutable audit log: ticket, agent, approvals, release
  releases/          # Linear-planned releases, manifests, notes, freezes
  integrations/{github,linear}/
  agent-iface/{cli,mcp}/
```

Flow: tickets come from Linear, the scheduler estimates impact and produces a dispatch plan (what runs now, what waits, what merges into one job), agents take their tickets and work in worktrees, and finished work enters the queue. The queue rebases, runs CI on the merged result (catching semantic conflicts), clears the gates, and merges. A losing change is re-dispatched automatically. The release lifecycle assembles merged, ticketed work into releases. Everything lands in the audit log and on the Linear ticket.

---

## Best-in-class quality checklist

- [ ] **Headline test:** two tickets with overlapping impact are scheduled to *not* run concurrently (or are merged into one job), so the collision never occurs, proven on a sample repo.
- [ ] A genuine collision that slips through is caught by the queue (failed rebase or red CI) and the losing change re-runs and lands cleanly, without human intervention.
- [ ] A signature change that breaks a caller on another branch is caught by semantic detection before merge.
- [ ] A hotspot (migration) is correctly gated by an advisory lease while the rest of the repo stays lock-free.
- [ ] The release lifecycle (branch, tag, hotfix fan-out, sync-develop) works, with the idempotency guards intact.
- [ ] Per-domain gates differ by risk, including a real HITL stop.
- [ ] Every merge traces to a ticket, an agent, and its approvals; a release manifest and notes generate from Linear.
- [ ] Agents drive the loop through MCP tools, not just the CLI.

---

## Milestones & status

| # | Milestone | Outcome | Status |
|---|-----------|---------|--------|
| M0 | Scaffold | control-plane, Postgres, GitHub App, port release.sh into release/, CI green | ☐ Not started |
| M1 | Worktrees + queue | per-task worktrees, adapter over an existing merge queue | ☐ Not started |
| M2 | Optimistic re-run | rebase, CI-on-result, automatic loser re-dispatch | ☐ Not started |
| M3 | Impact + scheduler | impact estimation, parallel/sequence/merge dispatch plan | ☐ Not started |
| M4 | Semantic conflicts | cross-branch typecheck/build detection | ☐ Not started |
| M5 | Hotspot leases | advisory locks for the declared un-mergeable set | ☐ Not started |
| M6 | Gates | scope / CI / QA / HITL, per-domain policy | ☐ Not started |
| M7 | Linear + provenance | ticket sync, immutable audit log | ☐ Not started |
| M8 | Releases | Linear-planned releases, manifests, notes, freezes | ☐ Not started |
| M9 | Agent interface | CLI + MCP, end-to-end fleet demo | ☐ Not started |

Status legend: ☐ Not started, ◐ In progress, ☑ Done, ⊘ Blocked.

---

## Definition of done

1. Overlapping tickets are scheduled apart or merged into one job, so most collisions never happen.
2. A collision that does happen is absorbed by the queue and the loser re-runs and lands, with no human merge.
3. A cross-branch semantic break is caught before merge.
4. Hotspots are lease-gated while the rest of the repo runs lock-free.
5. The ported release lifecycle works end to end, and every merge and release is ticketed and on the record.

## Stretch goals
- Learn impact estimates from observed merge outcomes (tickets that collided despite looking independent tighten the model).
- Speculative parallel CI across the queue for throughput without losing safety.
- Auto-heal trivial rebase conflicts instead of re-running.
- Emit scheduler, queue, and gate events into `watchtower` for fleet observability.

## Relationship to the portfolio
`conductor` runs one ticket to a PR. `harbormaster` is the layer above it that lets many `conductor` runs (and Claude Code / Cursor agents) share a repo: scheduling them apart, integrating them safely, and shipping their work on the record. `spelunk` powers the impact analysis, and `watchtower` observes the fleet.

## Note on `release.sh`
The `ggsa-spt` script is the seed for `release/`: semver, branch lifecycle, tagging, hotfix fan-out, and sync-develop port over with their idempotency guards. What harbormaster adds is everything above the manual merge step, because that manual step is exactly where a single-human tool stops scaling to a fleet.
