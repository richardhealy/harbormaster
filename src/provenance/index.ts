import type { AuditEvent, AuditEventType, PersistedAuditEvent, ProvenanceQuery } from './types'

export type { AuditEvent, AuditEventType, PersistedAuditEvent, ProvenanceQuery }
export { AUDIT_EVENT_TYPES } from './types'

/** Subset of `pg.Pool` the recorder needs; keeps it testable without a real database. */
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
 * Append-only audit trail: every dispatch, gate decision, merge, and
 * release ties back to a ticket and an agent through this class. Rows are
 * never updated or deleted by application code — `record` only inserts.
 */
export class ProvenanceRecorder {
  constructor(private readonly pool: ProvenancePool) {}

  /** Inserts one audit row and returns its generated id. */
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

  /** Builds a parameterised `SELECT` from whichever filters are set in `params`; defaults to the latest 100 rows. */
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

  /** Convenience wrapper over {@link query} for all events tied to a ticket. */
  async queryByTicket(ticketId: string, limit = 100): Promise<PersistedAuditEvent[]> {
    return this.query({ ticketId, limit })
  }

  /** Convenience wrapper over {@link query} for all events tied to a dispatch/agent run. */
  async queryByDispatch(dispatchId: string): Promise<PersistedAuditEvent[]> {
    return this.query({ agentId: dispatchId, limit: 500 })
  }

  /** Full history for a ticket, in descending time order — the audit trail shown for "what happened to this ticket". */
  async getTrail(ticketId: string): Promise<PersistedAuditEvent[]> {
    return this.query({ ticketId, limit: 1000 })
  }
}

export function createProvenanceRecorder(pool: ProvenancePool): ProvenanceRecorder {
  return new ProvenanceRecorder(pool)
}
