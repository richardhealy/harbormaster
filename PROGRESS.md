# Harbormaster — Progress

## Implementation

| # | Milestone | Status |
|---|-----------|--------|
| M0 | Scaffold: TypeScript project, Postgres schema, GitHub App webhook handler, release lifecycle ported from release.sh, CI green | ☑ Done |
| M1 | Worktrees + queue: per-task git worktrees, adapter over GitHub merge queue / Mergify | ☐ Not started |
| M2 | Optimistic re-run: rebase onto new tip, CI-on-result, automatic loser re-dispatch | ☐ Not started |
| M3 | Impact + scheduler: dependency-graph impact estimation, parallel/sequence/merge dispatch plan | ☐ Not started |
| M4 | Semantic conflicts: cross-branch typecheck/build conflict detection | ☐ Not started |
| M5 | Hotspot leases: advisory locks for declared un-mergeable paths (migrations, shared contracts) | ☐ Not started |
| M6 | Gates: scope / CI / QA / HITL gate pipeline with per-domain policy | ☐ Not started |
| M7 | Linear + provenance: ticket sync, immutable audit log tied to every dispatch and merge | ☐ Not started |
| M8 | Releases: Linear-planned releases, manifests, notes, freeze windows | ☐ Not started |
| M9 | Agent interface: CLI + MCP server, end-to-end fleet demo | ☐ Not started |

## Documentation

| Deliverable | Status |
|-------------|--------|
| Doc comments / inline documentation | ☐ Not started |
| API reference (OpenAPI + docs/api.md) | ☐ Not started |
| Architecture dossier (docs/architecture.md) | ☐ Not started |
| Integration guide (docs/integration.md) | ☐ Not started |
| Usage / how-to guides + docs/ index | ☐ Not started |
| Final README.md pass | ☐ Not started |
