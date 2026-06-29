export type AuditEventType =
  | 'dispatch'
  | 'branch_created'
  | 'gate_passed'
  | 'gate_failed'
  | 'merge'
  | 'rerun'
  | 'lease_acquired'
  | 'lease_released'
  | 'release_created'
  | 'release_tagged';

export interface AuditEvent {
  id: string;
  eventType: AuditEventType;
  ticketId?: string;
  agentId?: string;
  branch?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}
