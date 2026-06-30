/**
 * The fixed set of event kinds tracked in the audit log: every dispatch,
 * branch action, gate decision, merge, release action, and ticket sync
 * that should be tied back to a Linear ticket per the provenance spec.
 */
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

/** One of the kinds of events recorded in the audit log. See {@link AUDIT_EVENT_TYPES}. */
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number]

/**
 * An audit event as submitted for recording, before it has an id or
 * timestamp assigned by the database.
 */
export interface AuditEvent {
  eventType: AuditEventType
  payload: Record<string, unknown>
  ticketId?: string
  agentId?: string
  actor: string
}

/** An audit event as persisted in `audit_log`, after `ProvenanceRecorder.record` has run. */
export interface PersistedAuditEvent extends AuditEvent {
  id: string
  createdAt: Date
}

/** Filter parameters accepted by {@link ProvenanceRecorder.query}. */
export interface ProvenanceQuery {
  ticketId?: string
  agentId?: string
  eventType?: AuditEventType
  since?: Date
  limit?: number
}
