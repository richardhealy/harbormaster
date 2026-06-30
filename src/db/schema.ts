/**
 * TypeScript types mirroring the database schema (see
 * `src/db/migrations/001_initial.sql`). Keep these in sync with the SQL
 * column definitions by hand — there is no codegen step.
 */

/**
 * Append-only record of a notable event in the system (e.g. a dispatch
 * transition or gate decision), used for traceability/provenance rather
 * than as an operational data source. `ticket_id` and `agent_id` are
 * nullable because not every audited event is tied to a ticket or agent.
 */
export interface AuditLogEntry {
  id: string
  event_type: string
  payload: Record<string, unknown>
  ticket_id: string | null
  agent_id: string | null
  actor: string
  created_at: Date
}

/**
 * A unit of work tracked by harbormaster, typically sourced from Linear.
 * `linear_data` holds the raw upstream payload for fields not otherwise
 * normalized into columns.
 */
export interface Ticket {
  id: string
  title: string
  status: string
  priority: number | null
  labels: string[]
  assignee_id: string | null
  linear_data: Record<string, unknown> | null
  created_at: Date
  updated_at: Date
}

/** Lifecycle state of a {@link Dispatch}. */
export type DispatchStatus = 'pending' | 'running' | 'complete' | 'failed' | 'cancelled'

/**
 * A single assignment of a ticket to an agent working in its own branch
 * and worktree. `impact_surface` captures the (file/module-level) blast
 * radius of the dispatch's changes, used for conflict-aware scheduling.
 */
export interface Dispatch {
  id: string
  ticket_id: string
  agent_id: string
  branch: string
  worktree_path: string | null
  status: DispatchStatus
  impact_surface: Record<string, unknown> | null
  created_at: Date
  updated_at: Date
}

/**
 * The kind of check a {@link GateDecision} represents: automated scope
 * validation, CI, QA, or human-in-the-loop sign-off.
 */
export type GateType = 'scope' | 'ci' | 'qa' | 'hitl'

/** Outcome of a {@link GateDecision}; `skip` covers gates not applicable to a given dispatch. */
export type GateStatus = 'pending' | 'pass' | 'fail' | 'skip'

/**
 * A pass/fail/skip checkpoint a dispatch must clear before merging.
 * `decided_at` is null until the gate has been resolved; `actor` and
 * `notes` are null for gates resolved automatically without comment.
 */
export interface GateDecision {
  id: string
  dispatch_id: string
  gate_type: GateType
  status: GateStatus
  actor: string | null
  notes: string | null
  decided_at: Date | null
  created_at: Date
}

/** Lifecycle state of a {@link Release}. */
export type ReleaseStatus = 'planning' | 'active' | 'frozen' | 'released' | 'abandoned'

/**
 * A release train, generally corresponding to a Linear cycle and a
 * release branch. `freeze_at` marks when the release stops accepting new
 * work; `manifest` records what was included (e.g. ticket/dispatch IDs).
 */
export interface Release {
  id: string
  version: string
  branch: string
  status: ReleaseStatus
  linear_cycle_id: string | null
  manifest: Record<string, unknown> | null
  notes: string | null
  freeze_at: Date | null
  released_at: Date | null
  created_at: Date
  updated_at: Date
}
