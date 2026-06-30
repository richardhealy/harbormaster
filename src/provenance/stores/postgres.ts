import type { Pool } from 'pg'
import type { AuditStore, AuditEvent, AuditLogEntry, AuditQueryOptions, AuditEventType } from '../types.js'

/** Postgres-backed audit store. Writes go to the audit_log table from 001_initial.sql. */
export class PostgresAuditStore implements AuditStore {
  constructor(private readonly pool: Pool) {}

  async append(event: AuditEvent): Promise<AuditLogEntry> {
    const result = await this.pool.query<{
      id: string
      event_type: string
      payload: Record<string, unknown>
      ticket_id: string | null
      agent_id: string | null
      actor: string
      created_at: Date
    }>(
      `INSERT INTO audit_log (event_type, payload, ticket_id, agent_id, actor)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [event.eventType, JSON.stringify(event.payload), event.ticketId ?? null, event.agentId ?? null, event.actor],
    )
    const row = result.rows[0]
    return rowToEntry(row)
  }

  async query(opts: AuditQueryOptions): Promise<AuditLogEntry[]> {
    const conditions: string[] = []
    const params: unknown[] = []
    let idx = 1

    if (opts.ticketId !== undefined) {
      conditions.push(`ticket_id = $${idx++}`)
      params.push(opts.ticketId)
    }
    if (opts.agentId !== undefined) {
      conditions.push(`agent_id = $${idx++}`)
      params.push(opts.agentId)
    }
    if (opts.eventType !== undefined) {
      conditions.push(`event_type = $${idx++}`)
      params.push(opts.eventType)
    }
    if (opts.since !== undefined) {
      conditions.push(`created_at >= $${idx++}`)
      params.push(opts.since)
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = opts.limit !== undefined ? `LIMIT $${idx}` : ''
    if (opts.limit !== undefined) params.push(opts.limit)

    const result = await this.pool.query<{
      id: string
      event_type: string
      payload: Record<string, unknown>
      ticket_id: string | null
      agent_id: string | null
      actor: string
      created_at: Date
    }>(`SELECT * FROM audit_log ${where} ORDER BY created_at DESC ${limit}`, params)

    return result.rows.map(rowToEntry)
  }
}

function rowToEntry(row: {
  id: string
  event_type: string
  payload: Record<string, unknown>
  ticket_id: string | null
  agent_id: string | null
  actor: string
  created_at: Date
}): AuditLogEntry {
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
