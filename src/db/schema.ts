/** TypeScript types mirroring the database schema */

export interface AuditLogEntry {
  id: string
  event_type: string
  payload: Record<string, unknown>
  ticket_id: string | null
  agent_id: string | null
  actor: string
  created_at: Date
}

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

export type DispatchStatus = 'pending' | 'running' | 'complete' | 'failed' | 'cancelled'

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

export type GateType = 'scope' | 'ci' | 'qa' | 'hitl'
export type GateStatus = 'pending' | 'pass' | 'fail' | 'skip'

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

export type ReleaseStatus = 'planning' | 'active' | 'frozen' | 'released' | 'abandoned'

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
