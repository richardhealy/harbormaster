import { describe, it, expect, vi } from 'vitest'
import { TicketSyncer } from '../../src/integrations/linear/sync'
import type { LinearClient, LinearTicket } from '../../src/integrations/linear/index'
import type { SyncPool } from '../../src/integrations/linear/sync'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TICKET: LinearTicket = {
  id: 'issue-uuid-1',
  identifier: 'ENG-123',
  title: 'Add auth flow',
  priority: 2,
  state: { id: 'state-1', name: 'In Progress', type: 'started' },
  labels: [{ id: 'label-1', name: 'backend' }],
  assignee: { id: 'user-1', name: 'Alice' },
}

function makePool(): SyncPool & { query: ReturnType<typeof vi.fn> } {
  return { query: vi.fn().mockResolvedValue(undefined) }
}

function makeLinear(tickets: LinearTicket[] = []): LinearClient {
  return { listTeamIssues: vi.fn().mockResolvedValue(tickets) } as unknown as LinearClient
}

// ---------------------------------------------------------------------------
// syncTicket
// ---------------------------------------------------------------------------

describe('TicketSyncer.syncTicket', () => {
  it('issues an INSERT … ON CONFLICT upsert', async () => {
    const pool = makePool()
    const syncer = new TicketSyncer(pool, makeLinear())
    await syncer.syncTicket(TICKET)
    expect(pool.query).toHaveBeenCalledOnce()
    const [sql] = pool.query.mock.calls[0] as [string]
    expect(sql).toContain('INSERT INTO tickets')
    expect(sql).toContain('ON CONFLICT')
  })

  it('maps ticket fields to the correct positional parameters', async () => {
    const pool = makePool()
    const syncer = new TicketSyncer(pool, makeLinear())
    await syncer.syncTicket(TICKET)
    const [, values] = pool.query.mock.calls[0] as [string, unknown[]]
    expect(values[0]).toBe('issue-uuid-1') // id
    expect(values[1]).toBe('Add auth flow') // title
    expect(values[2]).toBe('In Progress')   // status (state name)
    expect(values[3]).toBe(2)               // priority
    expect(values[4]).toEqual(['backend'])  // labels (names only)
    expect(values[5]).toBe('user-1')        // assignee_id
  })

  it('sets assignee_id to null when ticket has no assignee', async () => {
    const pool = makePool()
    const syncer = new TicketSyncer(pool, makeLinear())
    await syncer.syncTicket({ ...TICKET, assignee: undefined })
    const [, values] = pool.query.mock.calls[0] as [string, unknown[]]
    expect(values[5]).toBeNull()
  })

  it('passes the full ticket object as linear_data', async () => {
    const pool = makePool()
    const syncer = new TicketSyncer(pool, makeLinear())
    await syncer.syncTicket(TICKET)
    const [, values] = pool.query.mock.calls[0] as [string, unknown[]]
    expect(values[6]).toBe(TICKET) // linear_data
  })
})

// ---------------------------------------------------------------------------
// syncTeamTickets
// ---------------------------------------------------------------------------

describe('TicketSyncer.syncTeamTickets', () => {
  it('returns synced count equal to the number of tickets', async () => {
    const pool = makePool()
    const t2 = { ...TICKET, id: 'issue-uuid-2', identifier: 'ENG-124' }
    const syncer = new TicketSyncer(pool, makeLinear([TICKET, t2]))
    const result = await syncer.syncTeamTickets('team-1')
    expect(result.synced).toBe(2)
    expect(result.errors).toBe(0)
  })

  it('increments error count when an upsert throws', async () => {
    const pool: SyncPool = { query: vi.fn().mockRejectedValue(new Error('db error')) }
    const syncer = new TicketSyncer(pool, makeLinear([TICKET]))
    const result = await syncer.syncTeamTickets('team-1')
    expect(result.synced).toBe(0)
    expect(result.errors).toBe(1)
  })

  it('forwards limit option to the Linear client', async () => {
    const pool = makePool()
    const linear = makeLinear([])
    const syncer = new TicketSyncer(pool, linear)
    await syncer.syncTeamTickets('team-1', { limit: 10 })
    expect(linear.listTeamIssues).toHaveBeenCalledWith('team-1', { limit: 10 })
  })

  it('continues syncing remaining tickets after a single failure', async () => {
    let callCount = 0
    const pool: SyncPool = {
      query: vi.fn().mockImplementation(() => {
        callCount++
        return callCount === 1 ? Promise.reject(new Error('first fails')) : Promise.resolve(null)
      }),
    }
    const t2 = { ...TICKET, id: 'issue-uuid-2' }
    const syncer = new TicketSyncer(pool, makeLinear([TICKET, t2]))
    const result = await syncer.syncTeamTickets('team-1')
    expect(result.synced).toBe(1)
    expect(result.errors).toBe(1)
  })
})
