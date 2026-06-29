# Harbormaster — Progress

## Implementation

| # | Milestone | Status |
|---|-----------|--------|
| M0 | Scaffold: TypeScript project, Postgres schema, GitHub App skeleton, release lifecycle ported from release.sh, CI green | ☑ Done |
| M1 | Worktrees + queue: per-task git worktrees, adapter over GitHub merge queue / Mergify | ☐ Not started |
| M2 | Optimistic re-run: rebase onto tip, CI-on-merged-result, automatic loser re-dispatch | ☐ Not started |
| M3 | Impact + scheduler: dependency graph, impact estimation, parallel/sequence/merge dispatch plan | ☐ Not started |
| M4 | Semantic conflicts: cross-branch typecheck/build detection | ☐ Not started |
| M5 | Hotspot leases: advisory locks for declared un-mergeable spots | ☐ Not started |
| M6 | Gates: scope / CI / QA / HITL pipeline, per-domain policy | ☐ Not started |
| M7 | Linear + provenance: ticket sync, immutable audit log | ☐ Not started |
| M8 | Releases: Linear-planned releases, manifests, notes, freeze windows | ☐ Not started |
| M9 | Agent interface: CLI + MCP server, end-to-end fleet demo | ☐ Not started |

## Documentation

| # | Deliverable | Status |
|---|-------------|--------|
| D1 | Inline doc comments across public surface (TSDoc) | ☐ Not started |
| D2 | API reference + OpenAPI spec | ☐ Not started |
| D3 | Architecture dossier (`docs/architecture.md`) | ☐ Not started |
| D4 | Integration guide (`docs/integration.md`) | ☐ Not started |
| D5 | Usage / how-to guides + `docs/` index + final README pass | ☐ Not started |
