import { describe, it, expect, vi } from 'vitest'
import { LinearClient } from '../../src/integrations/linear/index'
import type { FetchFn } from '../../src/integrations/linear/index'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFetch(data: unknown, status = 200): FetchFn {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  })
}

const SAMPLE_ISSUE = {
  id: 'issue-uuid-1',
  identifier: 'ENG-123',
  title: 'Add auth flow',
  description: 'Implement OAuth2',
  priority: 2,
  url: 'https://linear.app/issue/ENG-123',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-02T00:00:00Z',
  state: { id: 'state-1', name: 'In Progress', type: 'started' },
  labels: { nodes: [{ id: 'label-1', name: 'backend' }] },
  assignee: { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
}

// ---------------------------------------------------------------------------
// getTicket
// ---------------------------------------------------------------------------

describe('LinearClient.getTicket', () => {
  it('returns null when issue is not found', async () => {
    const fetch = makeFetch({ data: { issue: null } })
    const client = new LinearClient('api-key', fetch)
    expect(await client.getTicket('ENG-999')).toBeNull()
  })

  it('returns a normalised ticket with flat labels array', async () => {
    const fetch = makeFetch({ data: { issue: SAMPLE_ISSUE } })
    const client = new LinearClient('api-key', fetch)
    const ticket = await client.getTicket('ENG-123')
    expect(ticket).not.toBeNull()
    expect(ticket!.id).toBe('issue-uuid-1')
    expect(ticket!.identifier).toBe('ENG-123')
    expect(ticket!.labels).toEqual([{ id: 'label-1', name: 'backend' }])
    expect(ticket!.assignee?.name).toBe('Alice')
  })

  it('sends the Authorization header with the API key', async () => {
    const fetch = makeFetch({ data: { issue: null } })
    const client = new LinearClient('lin_api_test123', fetch)
    await client.getTicket('ENG-1')
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'lin_api_test123' }),
      }),
    )
  })

  it('throws on HTTP error', async () => {
    const fetch = makeFetch({}, 500)
    const client = new LinearClient('api-key', fetch)
    await expect(client.getTicket('ENG-1')).rejects.toThrow('HTTP 500')
  })

  it('throws on GraphQL error response', async () => {
    const fetch = makeFetch({ errors: [{ message: 'Unauthorized' }] })
    const client = new LinearClient('api-key', fetch)
    await expect(client.getTicket('ENG-1')).rejects.toThrow('Unauthorized')
  })

  it('throws when data is absent from response', async () => {
    const fetch = makeFetch({ something: 'else' })
    const client = new LinearClient('api-key', fetch)
    await expect(client.getTicket('ENG-1')).rejects.toThrow('no data')
  })
})

// ---------------------------------------------------------------------------
// updateTicketStatus
// ---------------------------------------------------------------------------

describe('LinearClient.updateTicketStatus', () => {
  it('resolves without throwing on success', async () => {
    const fetch = makeFetch({ data: { issueUpdate: { success: true } } })
    const client = new LinearClient('api-key', fetch)
    await expect(client.updateTicketStatus('issue-uuid-1', 'state-done')).resolves.toBeUndefined()
  })

  it('sends correct ticketId and stateId in mutation variables', async () => {
    const fetch = makeFetch({ data: { issueUpdate: { success: true } } })
    const client = new LinearClient('api-key', fetch)
    await client.updateTicketStatus('issue-uuid-1', 'state-done')
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse(init.body as string) as { variables: Record<string, unknown> }
    expect(body.variables).toMatchObject({ id: 'issue-uuid-1', stateId: 'state-done' })
  })
})

// ---------------------------------------------------------------------------
// listTeamIssues
// ---------------------------------------------------------------------------

describe('LinearClient.listTeamIssues', () => {
  it('returns normalised tickets with flat labels', async () => {
    const fetch = makeFetch({ data: { team: { issues: { nodes: [SAMPLE_ISSUE] } } } })
    const client = new LinearClient('api-key', fetch)
    const tickets = await client.listTeamIssues('team-1')
    expect(tickets).toHaveLength(1)
    expect(tickets[0].identifier).toBe('ENG-123')
    expect(tickets[0].labels).toEqual([{ id: 'label-1', name: 'backend' }])
  })

  it('returns empty array when team has no issues', async () => {
    const fetch = makeFetch({ data: { team: { issues: { nodes: [] } } } })
    const client = new LinearClient('api-key', fetch)
    expect(await client.listTeamIssues('team-1')).toHaveLength(0)
  })

  it('passes limit and filter as GraphQL variables', async () => {
    const fetch = makeFetch({ data: { team: { issues: { nodes: [] } } } })
    const client = new LinearClient('api-key', fetch)
    await client.listTeamIssues('team-1', {
      limit: 25,
      filter: { state: { type: { eq: 'started' } } },
    })
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse(init.body as string) as {
      variables: { limit: number; filter: unknown }
    }
    expect(body.variables.limit).toBe(25)
    expect(body.variables.filter).toMatchObject({ state: { type: { eq: 'started' } } })
  })

  it('defaults limit to 50 when not specified', async () => {
    const fetch = makeFetch({ data: { team: { issues: { nodes: [] } } } })
    const client = new LinearClient('api-key', fetch)
    await client.listTeamIssues('team-1')
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse(init.body as string) as { variables: { limit: number } }
    expect(body.variables.limit).toBe(50)
  })
})

// ---------------------------------------------------------------------------
// getWorkflowStates
// ---------------------------------------------------------------------------

describe('LinearClient.getWorkflowStates', () => {
  it('returns workflow state nodes', async () => {
    const fetch = makeFetch({
      data: {
        workflowStates: {
          nodes: [
            { id: 's1', name: 'Todo', type: 'unstarted', color: '#aaa' },
            { id: 's2', name: 'Done', type: 'completed', color: '#0f0' },
          ],
        },
      },
    })
    const client = new LinearClient('api-key', fetch)
    const states = await client.getWorkflowStates('team-1')
    expect(states).toHaveLength(2)
    expect(states[0].name).toBe('Todo')
    expect(states[1].type).toBe('completed')
  })

  it('returns empty array when no states exist', async () => {
    const fetch = makeFetch({ data: { workflowStates: { nodes: [] } } })
    const client = new LinearClient('api-key', fetch)
    expect(await client.getWorkflowStates('team-1')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// listCycleIssues
// ---------------------------------------------------------------------------

describe('LinearClient.listCycleIssues', () => {
  it('returns normalised tickets for a cycle', async () => {
    const fetch = makeFetch({ data: { cycle: { issues: { nodes: [SAMPLE_ISSUE] } } } })
    const client = new LinearClient('api-key', fetch)
    const tickets = await client.listCycleIssues('cycle-1')
    expect(tickets).toHaveLength(1)
    expect(tickets[0].identifier).toBe('ENG-123')
    expect(tickets[0].labels).toEqual([{ id: 'label-1', name: 'backend' }])
  })

  it('returns empty array when the cycle has no issues', async () => {
    const fetch = makeFetch({ data: { cycle: { issues: { nodes: [] } } } })
    const client = new LinearClient('api-key', fetch)
    expect(await client.listCycleIssues('cycle-1')).toHaveLength(0)
  })

  it('returns empty array when cycle is null', async () => {
    const fetch = makeFetch({ data: { cycle: null } })
    const client = new LinearClient('api-key', fetch)
    expect(await client.listCycleIssues('cycle-missing')).toHaveLength(0)
  })

  it('passes cycleId and limit as GraphQL variables', async () => {
    const fetch = makeFetch({ data: { cycle: { issues: { nodes: [] } } } })
    const client = new LinearClient('api-key', fetch)
    await client.listCycleIssues('cycle-1', 25)
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse(init.body as string) as { variables: Record<string, unknown> }
    expect(body.variables.cycleId).toBe('cycle-1')
    expect(body.variables.limit).toBe(25)
  })

  it('defaults limit to 50 when not specified', async () => {
    const fetch = makeFetch({ data: { cycle: { issues: { nodes: [] } } } })
    const client = new LinearClient('api-key', fetch)
    await client.listCycleIssues('cycle-1')
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const body = JSON.parse(init.body as string) as { variables: { limit: number } }
    expect(body.variables.limit).toBe(50)
  })
})
