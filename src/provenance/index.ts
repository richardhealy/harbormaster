import { randomUUID } from "crypto";
import type { DbClient } from "../db/client.js";

export type GateType = "scope" | "ci" | "qa" | "hitl";
export type GateStatus = "pending" | "passed" | "failed" | "skipped";

export interface GateEventParams {
  ticketId: string;
  worktreeId?: string;
  gate: GateType;
  status: GateStatus;
  actor?: string;
  details?: Record<string, unknown>;
}

/**
 * Records an immutable gate event in the audit log.
 *
 * Every dispatch, gate decision, and merge is recorded here with its
 * associated ticket and actor. The log is append-only: rows are never
 * updated or deleted.
 */
export async function recordGateEvent(
  db: DbClient,
  params: GateEventParams
): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO gate_events (id, ticket_id, worktree_id, gate, status, actor, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      params.ticketId,
      params.worktreeId ?? null,
      params.gate,
      params.status,
      params.actor ?? null,
      params.details ? JSON.stringify(params.details) : null,
    ]
  );
  return id;
}

/**
 * Returns the full audit trail for a ticket, ordered oldest-first.
 */
export async function getTicketAuditTrail(
  db: DbClient,
  ticketId: string
): Promise<GateEventParams[]> {
  const result = await db.query(
    `SELECT ticket_id, worktree_id, gate, status, actor, details
     FROM gate_events
     WHERE ticket_id = $1
     ORDER BY created_at ASC`,
    [ticketId]
  );
  return result.rows.map((r) => ({
    ticketId: r.ticket_id as string,
    worktreeId: r.worktree_id as string | undefined,
    gate: r.gate as GateType,
    status: r.status as GateStatus,
    actor: r.actor as string | undefined,
    details: r.details as Record<string, unknown> | undefined,
  }));
}
