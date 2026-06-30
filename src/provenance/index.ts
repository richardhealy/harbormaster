/**
 * Implements the spec's immutable audit log: every dispatch, branch, gate
 * decision, and merge tied to a Linear ticket is recorded here so the
 * fleet's activity can be reconstructed and audited after the fact.
 */
import type { AuditEvent, AuditEventType, PersistedAuditEvent, ProvenanceQuery } from './types'

export type { AuditEvent, AuditEventType, PersistedAuditEvent, ProvenanceQuery }
export { AUDIT_EVENT_TYPES } from './types'

/** Minimal pool shape `ProvenanceRecorder` depends on, so tests can inject a fake. */
export interface ProvenancePool {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>
}

interface RawAuditRow {
  id: string
  event_type: string
  payload: Record<string, unknown>
  ticket_id: string | null
  agent_id: string | null
  actor: string
  created_at: Date
}

function rowToEvent(row: RawAuditRow): PersistedAuditEvent {
  return {
    id: row.id,
    eventType: row.event_type as AuditEventType,
    payload: row.payload,
    ticketId: row.ticket_id ?? undefined,
    agentId: row.agent_id ?? undefined,
    actor: row.actor,
    createdAt: row.created_at,
  }
}

/**
 * Records and queries the audit log. The pool is injected so this class can
 * be tested without a real database.
 *
 * `record` is the only write path, and there is deliberately no
 * update/delete — that append-only design is what makes this an audit
 * trail rather than a mutable status field: once an event is recorded, it
 * can't be altered or erased, so the history it builds up can be trusted.
 */
export class ProvenanceRecorder {
  constructor(private readonly pool: ProvenancePool) {}

  /**
   * Inserts a new event into `audit_log` and returns its generated id.
   * This is the only way to add to the log; there is no corresponding
   * update or delete method by design (see class docs).
   */
  async record(event: AuditEvent): Promise<string> {
    const result = await this.pool.query(
      `INSERT INTO audit_log (event_type, payload, ticket_id, agent_id, actor)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        event.eventType,
        event.payload,
        event.ticketId ?? null,
        event.agentId ?? null,
        event.actor,
      ],
    )
    return (result.rows[0] as { id: string }).id
  }

  /**
   * Runs a parameterised SELECT against `audit_log` with optional
   * `ticketId`/`agentId`/`eventType`/`since` filters, newest first.
   * The convenience read helpers below are all built on top of this method.
   */
  async query(params: ProvenanceQuery): Promise<PersistedAuditEvent[]> {
    const conditions: string[] = []
    const values: unknown[] = []
    let idx = 1

    if (params.ticketId !== undefined) {
      conditions.push(`ticket_id = $${idx++}`)
      values.push(params.ticketId)
    }
    if (params.agentId !== undefined) {
      conditions.push(`agent_id = $${idx++}`)
      values.push(params.agentId)
    }
    if (params.eventType !== undefined) {
      conditions.push(`event_type = $${idx++}`)
      values.push(params.eventType)
    }
    if (params.since !== undefined) {
      conditions.push(`created_at >= $${idx++}`)
      values.push(params.since)
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = params.limit ?? 100
    const text = `SELECT id, event_type, payload, ticket_id, agent_id, actor, created_at
      FROM audit_log
      ${where}
      ORDER BY created_at DESC
      LIMIT ${limit}`

    const result = await this.pool.query(text, values)
    return (result.rows as RawAuditRow[]).map(rowToEvent)
  }

  /** Convenience wrapper over {@link ProvenanceRecorder.query} for a single ticket. */
  async queryByTicket(ticketId: string, limit = 100): Promise<PersistedAuditEvent[]> {
    return this.query({ ticketId, limit })
  }

  /**
   * Convenience wrapper over {@link ProvenanceRecorder.query} for a single
   * dispatch. Dispatch ids are recorded as `agentId` on events, so this
   * filters by that field.
   */
  async queryByDispatch(dispatchId: string): Promise<PersistedAuditEvent[]> {
    return this.query({ agentId: dispatchId, limit: 500 })
  }

  /**
   * Returns the full audit trail for a ticket — every dispatch, gate
   * decision, and merge recorded against it — up to a high limit, suitable
   * for rendering a complete provenance history.
   */
  async getTrail(ticketId: string): Promise<PersistedAuditEvent[]> {
    return this.query({ ticketId, limit: 1000 })
  }
}

/** Factory for {@link ProvenanceRecorder}. */
export function createProvenanceRecorder(pool: ProvenancePool): ProvenanceRecorder {
  return new ProvenanceRecorder(pool)
}
