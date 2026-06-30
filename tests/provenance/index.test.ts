import { describe, it, expect, vi } from 'vitest'
import {
  ProvenanceRecorder,
  createProvenanceRecorder,
} from '../../src/provenance/index'
import type { AuditEvent, ProvenancePool } from '../../src/provenance/index'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_EVENT: AuditEvent = {
  eventType: 'dispatch.created',
  payload: { branch: 'feat/ENG-1/auth' },
  ticketId: 'ENG-1',
  agentId: 'agent-abc',
  actor: 'harbormaster',
}

const SAMPLE_ROW = {
  id: 'audit-uuid-1',
  event_type: 'dispatch.created',
  payload: { branch: 'feat/ENG-1/auth' },
  ticket_id: 'ENG-1',
  agent_id: 'agent-abc',
  actor: 'harbormaster',
  created_at: new Date('2024-06-01T12:00:00Z'),
}

function makePool(rowSets: unknown[][] = []): ProvenancePool & { query: ReturnType<typeof vi.fn> } {
  let call = 0
  return {
    query: vi.fn((_text: string, _values?: unknown[]) => {
      const rows = rowSets[call++] ?? []
      return Promise.resolve({ rows })
    }),
  }
}

// ---------------------------------------------------------------------------
// record
// ---------------------------------------------------------------------------

describe('ProvenanceRecorder.record', () => {
  it('inserts into audit_log and returns the generated id', async () => {
    const pool = makePool([[{ id: 'audit-uuid-1' }]])
    const recorder = new ProvenanceRecorder(pool)
    const id = await recorder.record(BASE_EVENT)
    expect(id).toBe('audit-uuid-1')
  })

  it('sends INSERT INTO audit_log with RETURNING id', async () => {
    const pool = makePool([[{ id: 'x' }]])
    const recorder = new ProvenanceRecorder(pool)
    await recorder.record(BASE_EVENT)
    const [sql] = pool.query.mock.calls[0] as [string]
    expect(sql).toContain('INSERT INTO audit_log')
    expect(sql).toContain('RETURNING id')
  })

  it('passes all event fields as positional parameters', async () => {
    const pool = makePool([[{ id: 'x' }]])
    const recorder = new ProvenanceRecorder(pool)
    await recorder.record(BASE_EVENT)
    const [, values] = pool.query.mock.calls[0] as [string, unknown[]]
    expect(values[0]).toBe('dispatch.created')
    expect(values[1]).toEqual({ branch: 'feat/ENG-1/auth' })
    expect(values[2]).toBe('ENG-1')
    expect(values[3]).toBe('agent-abc')
    expect(values[4]).toBe('harbormaster')
  })

  it('sets ticket_id and agent_id to null when absent', async () => {
    const pool = makePool([[{ id: 'y' }]])
    const recorder = new ProvenanceRecorder(pool)
    await recorder.record({ eventType: 'release.tagged', payload: {}, actor: 'ci' })
    const [, values] = pool.query.mock.calls[0] as [string, unknown[]]
    expect(values[2]).toBeNull() // ticket_id
    expect(values[3]).toBeNull() // agent_id
  })
})

// ---------------------------------------------------------------------------
// query
// ---------------------------------------------------------------------------

describe('ProvenanceRecorder.query', () => {
  it('maps rows to PersistedAuditEvents', async () => {
    const pool = makePool([[SAMPLE_ROW]])
    const recorder = new ProvenanceRecorder(pool)
    const events = await recorder.query({ ticketId: 'ENG-1' })
    expect(events).toHaveLength(1)
    expect(events[0].id).toBe('audit-uuid-1')
    expect(events[0].eventType).toBe('dispatch.created')
    expect(events[0].payload).toEqual({ branch: 'feat/ENG-1/auth' })
    expect(events[0].ticketId).toBe('ENG-1')
    expect(events[0].agentId).toBe('agent-abc')
    expect(events[0].createdAt).toBeInstanceOf(Date)
  })

  it('adds ticket_id condition when ticketId is supplied', async () => {
    const pool = makePool([[]])
    const recorder = new ProvenanceRecorder(pool)
    await recorder.query({ ticketId: 'ENG-5' })
    const [sql, values] = pool.query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('ticket_id')
    expect(values).toContain('ENG-5')
  })

  it('adds event_type condition when eventType is supplied', async () => {
    const pool = makePool([[]])
    const recorder = new ProvenanceRecorder(pool)
    await recorder.query({ eventType: 'gate.hitl' })
    const [sql, values] = pool.query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('event_type')
    expect(values).toContain('gate.hitl')
  })

  it('adds agent_id condition when agentId is supplied', async () => {
    const pool = makePool([[]])
    const recorder = new ProvenanceRecorder(pool)
    await recorder.query({ agentId: 'agent-x' })
    const [sql, values] = pool.query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('agent_id')
    expect(values).toContain('agent-x')
  })

  it('adds created_at condition when since is supplied', async () => {
    const pool = makePool([[]])
    const recorder = new ProvenanceRecorder(pool)
    const since = new Date('2024-01-01')
    await recorder.query({ since })
    const [sql, values] = pool.query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('created_at')
    expect(values).toContain(since)
  })

  it('combines multiple conditions with AND', async () => {
    const pool = makePool([[]])
    const recorder = new ProvenanceRecorder(pool)
    await recorder.query({ ticketId: 'ENG-2', agentId: 'agent-x' })
    const [sql] = pool.query.mock.calls[0] as [string]
    expect((sql.match(/AND/g) ?? []).length).toBe(1)
  })

  it('omits WHERE clause when no filters supplied', async () => {
    const pool = makePool([[]])
    const recorder = new ProvenanceRecorder(pool)
    await recorder.query({})
    const [sql] = pool.query.mock.calls[0] as [string]
    expect(sql).not.toContain('WHERE')
  })

  it('returns empty array when no rows match', async () => {
    const pool = makePool([[]])
    const recorder = new ProvenanceRecorder(pool)
    const events = await recorder.query({})
    expect(events).toHaveLength(0)
  })

  it('applies the default LIMIT of 100 when not specified', async () => {
    const pool = makePool([[]])
    const recorder = new ProvenanceRecorder(pool)
    await recorder.query({})
    const [sql] = pool.query.mock.calls[0] as [string]
    expect(sql).toContain('LIMIT 100')
  })

  it('omits ticketId from result when column is null', async () => {
    const row = { ...SAMPLE_ROW, ticket_id: null, agent_id: null }
    const pool = makePool([[row]])
    const recorder = new ProvenanceRecorder(pool)
    const events = await recorder.query({})
    expect(events[0].ticketId).toBeUndefined()
    expect(events[0].agentId).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// queryByTicket
// ---------------------------------------------------------------------------

describe('ProvenanceRecorder.queryByTicket', () => {
  it('queries with the given ticketId and limit', async () => {
    const pool = makePool([[]])
    const recorder = new ProvenanceRecorder(pool)
    await recorder.queryByTicket('ENG-7', 50)
    const [sql, values] = pool.query.mock.calls[0] as [string, unknown[]]
    expect(values).toContain('ENG-7')
    expect(sql).toContain('LIMIT 50')
  })
})

// ---------------------------------------------------------------------------
// queryByDispatch
// ---------------------------------------------------------------------------

describe('ProvenanceRecorder.queryByDispatch', () => {
  it('queries by agent_id using the dispatch id', async () => {
    const pool = makePool([[]])
    const recorder = new ProvenanceRecorder(pool)
    await recorder.queryByDispatch('dispatch-abc')
    const [sql, values] = pool.query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('agent_id')
    expect(values).toContain('dispatch-abc')
  })
})

// ---------------------------------------------------------------------------
// getTrail
// ---------------------------------------------------------------------------

describe('ProvenanceRecorder.getTrail', () => {
  it('returns the full audit trail for a ticket', async () => {
    const mergeRow = {
      id: 'a2',
      event_type: 'merge.completed',
      payload: {},
      ticket_id: 'ENG-3',
      agent_id: null,
      actor: 'queue',
      created_at: new Date(),
    }
    const pool = makePool([[mergeRow]])
    const recorder = new ProvenanceRecorder(pool)
    const trail = await recorder.getTrail('ENG-3')
    expect(trail).toHaveLength(1)
    expect(trail[0].eventType).toBe('merge.completed')
  })
})

// ---------------------------------------------------------------------------
// createProvenanceRecorder factory
// ---------------------------------------------------------------------------

describe('createProvenanceRecorder', () => {
  it('returns a ProvenanceRecorder instance', () => {
    const pool = makePool()
    expect(createProvenanceRecorder(pool)).toBeInstanceOf(ProvenanceRecorder)
  })
})
