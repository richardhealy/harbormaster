import { describe, it, expect, vi } from 'vitest'
import { LinearClient } from '../../src/integrations/linear/index.js'
import type { FetchFn } from '../../src/integrations/linear/types.js'

function makeFetch(data: unknown, ok = true): FetchFn {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 400,
    json: async () => data,
  })
}

const TICKET_NODE = {
  id: 'uuid-123',
  identifier: 'ENG-123',
  title: 'Fix the thing',
  state: { id: 'state-1', name: 'In Progress', type: 'started' },
  priority: 2,
  labels: { nodes: [{ id: 'label-1', name: 'bug' }] },
  assignee: { id: 'user-1', name: 'Alice' },
}

describe('LinearClient', () => {
  describe('getTicket', () => {
    it('returns a shaped ticket for a matching identifier', async () => {
      const fetch = makeFetch({ data: { issues: { nodes: [TICKET_NODE] } } })
      const client = new LinearClient('lin_key', fetch)

      const ticket = await client.getTicket('ENG-123')

      expect(ticket).not.toBeNull()
      expect(ticket?.id).toBe('uuid-123')
      expect(ticket?.identifier).toBe('ENG-123')
      expect(ticket?.title).toBe('Fix the thing')
      expect(ticket?.state.name).toBe('In Progress')
      expect(ticket?.labels).toHaveLength(1)
      expect(ticket?.labels[0].name).toBe('bug')
      expect(ticket?.assignee?.name).toBe('Alice')
    })

    it('returns null when no issues match', async () => {
      const fetch = makeFetch({ data: { issues: { nodes: [] } } })
      const client = new LinearClient('lin_key', fetch)

      const ticket = await client.getTicket('ENG-999')
      expect(ticket).toBeNull()
    })

    it('sends the identifier as a GraphQL variable', async () => {
      const fetch = makeFetch({ data: { issues: { nodes: [] } } })
      const client = new LinearClient('lin_key', fetch)

      await client.getTicket('ENG-456')

      const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string)
      expect(body.variables.identifier).toBe('ENG-456')
    })

    it('sends the Authorization header', async () => {
      const fetch = makeFetch({ data: { issues: { nodes: [] } } })
      const client = new LinearClient('lin_api_key', fetch)

      await client.getTicket('ENG-1')

      const headers = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].headers as Record<string, string>
      expect(headers['Authorization']).toBe('lin_api_key')
    })

    it('throws on HTTP error', async () => {
      const fetch = makeFetch({}, false)
      const client = new LinearClient('lin_key', fetch)

      await expect(client.getTicket('ENG-1')).rejects.toThrow('Linear API error: HTTP 400')
    })

    it('throws on GraphQL errors', async () => {
      const fetch = makeFetch({ errors: [{ message: 'Unauthorized' }] })
      const client = new LinearClient('lin_key', fetch)

      await expect(client.getTicket('ENG-1')).rejects.toThrow('Linear GraphQL error: Unauthorized')
    })

    it('handles a ticket with no assignee', async () => {
      const node = { ...TICKET_NODE, assignee: null }
      const fetch = makeFetch({ data: { issues: { nodes: [node] } } })
      const client = new LinearClient('lin_key', fetch)

      const ticket = await client.getTicket('ENG-123')
      expect(ticket?.assignee).toBeUndefined()
    })

    it('handles a ticket with no labels', async () => {
      const node = { ...TICKET_NODE, labels: { nodes: [] } }
      const fetch = makeFetch({ data: { issues: { nodes: [node] } } })
      const client = new LinearClient('lin_key', fetch)

      const ticket = await client.getTicket('ENG-123')
      expect(ticket?.labels).toHaveLength(0)
    })
  })

  describe('updateTicketStatus', () => {
    it('returns true on success', async () => {
      const fetch = makeFetch({ data: { issueUpdate: { success: true } } })
      const client = new LinearClient('lin_key', fetch)

      const result = await client.updateTicketStatus('uuid-123', 'state-done')
      expect(result).toBe(true)
    })

    it('returns false when the mutation reports failure', async () => {
      const fetch = makeFetch({ data: { issueUpdate: { success: false } } })
      const client = new LinearClient('lin_key', fetch)

      const result = await client.updateTicketStatus('uuid-123', 'state-done')
      expect(result).toBe(false)
    })

    it('sends issueId and stateId as variables', async () => {
      const fetch = makeFetch({ data: { issueUpdate: { success: true } } })
      const client = new LinearClient('lin_key', fetch)

      await client.updateTicketStatus('uuid-abc', 'state-xyz')

      const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string)
      expect(body.variables.issueId).toBe('uuid-abc')
      expect(body.variables.stateId).toBe('state-xyz')
    })
  })

  describe('getWorkflowStates', () => {
    it('returns the workflow states for a team', async () => {
      const states = [
        { id: 's1', name: 'Todo', type: 'unstarted' },
        { id: 's2', name: 'In Progress', type: 'started' },
        { id: 's3', name: 'Done', type: 'completed' },
      ]
      const fetch = makeFetch({ data: { workflowStates: { nodes: states } } })
      const client = new LinearClient('lin_key', fetch)

      const result = await client.getWorkflowStates('team-1')
      expect(result).toHaveLength(3)
      expect(result[1].name).toBe('In Progress')
    })

    it('sends teamId as a variable', async () => {
      const fetch = makeFetch({ data: { workflowStates: { nodes: [] } } })
      const client = new LinearClient('lin_key', fetch)

      await client.getWorkflowStates('team-abc')

      const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string)
      expect(body.variables.teamId).toBe('team-abc')
    })
  })

  describe('getTeamIssues', () => {
    it('returns all issues for a team', async () => {
      const fetch = makeFetch({ data: { issues: { nodes: [TICKET_NODE] } } })
      const client = new LinearClient('lin_key', fetch)

      const issues = await client.getTeamIssues('team-1')
      expect(issues).toHaveLength(1)
      expect(issues[0].identifier).toBe('ENG-123')
    })

    it('includes cycleId in filter when provided', async () => {
      const fetch = makeFetch({ data: { issues: { nodes: [] } } })
      const client = new LinearClient('lin_key', fetch)

      await client.getTeamIssues('team-1', 'cycle-99')

      const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string)
      expect(body.variables.filter.cycle?.id?.eq).toBe('cycle-99')
    })

    it('omits cycleId filter when not provided', async () => {
      const fetch = makeFetch({ data: { issues: { nodes: [] } } })
      const client = new LinearClient('lin_key', fetch)

      await client.getTeamIssues('team-1')

      const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string)
      expect(body.variables.filter.cycle).toBeUndefined()
    })
  })
})
