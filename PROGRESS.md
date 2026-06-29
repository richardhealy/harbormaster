# harbormaster — Progress

## Implementation

- [x] **M0 — Scaffold**: Node/TypeScript project scaffold, Postgres connection and migrations, GitHub App webhook handler, release lifecycle (semver, branch creation, tagging, hotfix fan-out, sync-develop), scheduler (impact overlap, parallel/sequence/merge dispatch), gate pipeline (scope/CI/QA/HITL per-domain policy), hotspot advisory leases, integration layer (worktrees, queue adapter, semantic detection, rerun logic), MCP tool definitions, CLI interface, HTTP control-plane server, full test suite (67 tests), lint and typecheck clean.
- [ ] **M1 — Worktrees + queue**: End-to-end per-task worktree creation, real merge queue integration (GitHub merge queue or Mergify) with status polling.
- [ ] **M2 — Optimistic re-run**: Rebase-on-tip, CI-on-result, automatic loser re-dispatch via the rerun module.
- [ ] **M3 — Impact + scheduler**: Live impact estimation from the dependency graph (using spelunk or ts-morph), scheduler wired to real ticket dispatch.
- [ ] **M4 — Semantic conflicts**: Cross-branch typecheck/build across in-flight worktrees, blocking merge on detected conflict.
- [ ] **M5 — Hotspot leases**: Advisory lease enforcement wired into the dispatch path for declared hotspots (migrations, shared contracts).
- [ ] **M6 — Gates**: Full gate pipeline wired to real CI status, QA checks, and HITL approval workflow.
- [ ] **M7 — Linear + provenance**: Real Linear ticket sync, state transitions, immutable audit log written on every event.
- [ ] **M8 — Releases**: Linear-planned releases, release manifests, release notes, freeze windows.
- [ ] **M9 — Agent interface**: CLI command handling, MCP server wired end-to-end, fleet demo.

## Documentation

- [ ] Inline doc comments across public surface (TSDoc)
- [ ] API reference / OpenAPI spec + `docs/api.md`
- [ ] Architecture dossier (`docs/architecture.md`)
- [ ] Integration guide (`docs/integration.md`)
- [ ] Usage guides + `docs/` index + final README pass
