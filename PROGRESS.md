# Progress

## Implementation

- [x] M0 — Scaffold: control-plane, Postgres schema, GitHub App, release lifecycle ported from release.sh, CI green
- [ ] M1 — Worktrees + queue: per-task worktrees, adapter over an existing merge queue
- [ ] M2 — Optimistic re-run: rebase, CI-on-result, automatic loser re-dispatch
- [ ] M3 — Impact + scheduler: impact estimation, parallel/sequence/merge dispatch plan
- [ ] M4 — Semantic conflicts: cross-branch typecheck/build detection
- [ ] M5 — Hotspot leases: advisory locks for the declared un-mergeable set
- [ ] M6 — Gates: scope / CI / QA / HITL, per-domain policy
- [ ] M7 — Linear + provenance: ticket sync, immutable audit log
- [ ] M8 — Releases: Linear-planned releases, manifests, notes, freezes
- [ ] M9 — Agent interface: CLI + MCP, end-to-end fleet demo

## Documentation

- [ ] Inline doc comments across the public surface (TSDoc)
- [ ] API reference documentation (OpenAPI spec + docs/api.md)
- [ ] Architecture dossier at docs/architecture.md
- [ ] Integration guide at docs/integration.md
- [ ] Usage guides and docs/ index; final README.md pass
