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

export interface AuditEvent {
  eventType: AuditEventType
  payload: Record<string, unknown>
  ticketId?: string
  agentId?: string
  actor: string
}

export interface PersistedAuditEvent extends AuditEvent {
  id: string
  createdAt: Date
}

export interface ProvenanceQuery {
  ticketId?: string
  agentId?: string
  eventType?: AuditEventType
  since?: Date
  limit?: number
}
