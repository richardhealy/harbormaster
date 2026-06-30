export type AuditEventType =
  | 'ticket.synced'
  | 'dispatch.created'
  | 'dispatch.complete'
  | 'dispatch.failed'
  | 'dispatch.cancelled'
  | 'gate.passed'
  | 'gate.failed'
  | 'gate.skipped'
  | 'merge.success'
  | 'merge.failure'
  | 'rerun.dispatched'
  | 'release.created'
  | 'release.frozen'
  | 'release.released'
  | 'hotspot.acquired'
  | 'hotspot.released'

export interface AuditEvent {
  eventType: AuditEventType
  payload: Record<string, unknown>
  ticketId?: string
  agentId?: string
  actor: string
}

export interface AuditLogEntry extends AuditEvent {
  id: string
  createdAt: Date
}

export interface AuditQueryOptions {
  ticketId?: string
  agentId?: string
  eventType?: AuditEventType
  since?: Date
  limit?: number
}

export interface AuditStore {
  append(event: AuditEvent): Promise<AuditLogEntry>
  query(opts: AuditQueryOptions): Promise<AuditLogEntry[]>
}
