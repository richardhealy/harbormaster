/** Every event type the fleet may record. Adding a new kind of tracked action means adding it here. */
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

/** One fact to record before it's written to the database: what happened, to what ticket/agent, and who did it. */
export interface AuditEvent {
  eventType: AuditEventType
  payload: Record<string, unknown>
  ticketId?: string
  agentId?: string
  actor: string
}

/** An {@link AuditEvent} as read back from the immutable `audit_log` table. */
export interface PersistedAuditEvent extends AuditEvent {
  id: string
  createdAt: Date
}

/** Optional filters for {@link ProvenanceRecorder.query}; all fields are AND-ed together. */
export interface ProvenanceQuery {
  ticketId?: string
  agentId?: string
  eventType?: AuditEventType
  since?: Date
  limit?: number
}
