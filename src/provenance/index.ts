import { query } from '../db';

export type AuditEventType =
  | 'ticket.dispatched'
  | 'ticket.completed'
  | 'ticket.failed'
  | 'branch.created'
  | 'branch.merged'
  | 'gate.passed'
  | 'gate.failed'
  | 'gate.hitl_approved'
  | 'release.created'
  | 'release.tagged'
  | 'hotfix.started'
  | 'hotfix.finished'
  | 'lease.acquired'
  | 'lease.released'
  | 'conflict.detected';

export interface AuditEntry {
  id?: bigint;
  eventType: AuditEventType;
  ticketId?: string;
  agentId?: string;
  branch?: string;
  payload: Record<string, unknown>;
  createdAt?: Date;
}

export async function recordEvent(entry: Omit<AuditEntry, 'id' | 'createdAt'>): Promise<bigint> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO audit_log (event_type, ticket_id, agent_id, branch, payload)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [entry.eventType, entry.ticketId ?? null, entry.agentId ?? null, entry.branch ?? null, JSON.stringify(entry.payload)]
  );

  return BigInt(rows[0]!.id);
}

export async function getTicketHistory(ticketId: string): Promise<AuditEntry[]> {
  const { rows } = await query<{
    id: string;
    event_type: AuditEventType;
    ticket_id: string;
    agent_id: string;
    branch: string;
    payload: Record<string, unknown>;
    created_at: Date;
  }>(
    `SELECT id, event_type, ticket_id, agent_id, branch, payload, created_at
     FROM audit_log
     WHERE ticket_id = $1
     ORDER BY created_at ASC`,
    [ticketId]
  );

  return rows.map((r) => ({
    id: BigInt(r.id),
    eventType: r.event_type,
    ticketId: r.ticket_id,
    agentId: r.agent_id,
    branch: r.branch,
    payload: r.payload,
    createdAt: r.created_at,
  }));
}

export async function getReleaseProvenance(releaseVersion: string): Promise<AuditEntry[]> {
  const { rows } = await query<{
    id: string;
    event_type: AuditEventType;
    ticket_id: string;
    agent_id: string;
    branch: string;
    payload: Record<string, unknown>;
    created_at: Date;
  }>(
    `SELECT id, event_type, ticket_id, agent_id, branch, payload, created_at
     FROM audit_log
     WHERE payload->>'release_version' = $1
     ORDER BY created_at ASC`,
    [releaseVersion]
  );

  return rows.map((r) => ({
    id: BigInt(r.id),
    eventType: r.event_type,
    ticketId: r.ticket_id,
    agentId: r.agent_id,
    branch: r.branch,
    payload: r.payload,
    createdAt: r.created_at,
  }));
}
