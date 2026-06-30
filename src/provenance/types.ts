/** Every event type the audit log accepts, grouped by the subsystem that emits it (dispatch, gate, merge, release, ticket). The `audit_log.event_type` column is constrained to this set. */
export const AUDIT_EVENT_TYPES = [
  'dispatch.created',
  'dispatch.rebase',
  'dispatch.rerun',
  'dispatch.completed',
  'dispatch.failed',
  'gate.scope',
  'gate.ci',
  'gate.qa',
  'gate.hitl',
  'merge.queued',
  'merge.completed',
  'merge.failed',
  'release.created',
  'release.tagged',
  'ticket.synced',
  'ticket.status_updated',
] as const

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number]

/** An event as recorded by a caller — `actor` identifies who/what triggered it (an agent id, a human username, or a system component). */
export interface AuditEvent {
  eventType: AuditEventType
  payload: Record<string, unknown>
  ticketId?: string
  agentId?: string
  actor: string
}

/** An {@link AuditEvent} as read back from the `audit_log` table, after the database has assigned it an id and a timestamp. The log is append-only — there is no update or delete path. */
export interface PersistedAuditEvent extends AuditEvent {
  id: string
  createdAt: Date
}

/** Filter parameters for {@link ProvenanceRecorder.query} — all fields are optional and combined with AND. */
export interface ProvenanceQuery {
  ticketId?: string
  agentId?: string
  eventType?: AuditEventType
  since?: Date
  limit?: number
}
