/**
 * The closed set of events the audit log accepts, covering the spec's
 * provenance requirement: every dispatch, branch, gate decision, and merge
 * ties back to a ticket. Extend this list (not ad-hoc string event types)
 * when a new stage needs to record an event.
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

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number]

/** An event as recorded by a caller, before the database assigns it an id and timestamp. */
export interface AuditEvent {
  eventType: AuditEventType
  payload: Record<string, unknown>
  ticketId?: string
  agentId?: string
  actor: string
}

/** An {@link AuditEvent} as read back from `audit_log`. */
export interface PersistedAuditEvent extends AuditEvent {
  id: string
  createdAt: Date
}

/** Filters for {@link ProvenanceRecorder.query}; all fields are AND-ed together. */
export interface ProvenanceQuery {
  ticketId?: string
  agentId?: string
  eventType?: AuditEventType
  since?: Date
  limit?: number
}
