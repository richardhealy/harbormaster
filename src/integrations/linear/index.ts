import type { LinearTicket, LinearWorkflowState, FetchFn } from './types.js'

export type { LinearTicket, LinearWorkflowState, FetchFn, LinearState, LinearLabel, LinearUser, LinearSyncResult } from './types.js'

const LINEAR_GQL = 'https://api.linear.app/graphql'

const ISSUE_FIELDS = `
  id
  identifier
  title
  state { id name type }
  priority
  labels { nodes { id name } }
  assignee { id name }
`

function shapedTicket(raw: Record<string, unknown>): LinearTicket {
  return {
    id: String(raw.id ?? ''),
    identifier: String(raw.identifier ?? ''),
    title: String(raw.title ?? ''),
    state: raw.state as LinearTicket['state'],
    priority: Number(raw.priority ?? 0),
    labels: ((raw.labels as { nodes: unknown[] } | null)?.nodes ?? []) as LinearTicket['labels'],
    assignee: raw.assignee != null ? (raw.assignee as LinearTicket['assignee']) : undefined,
  }
}

export class LinearClient {
  private readonly apiKey: string
  private readonly fetch: FetchFn

  constructor(apiKey: string, fetchFn?: FetchFn) {
    this.apiKey = apiKey
    this.fetch = fetchFn ?? (globalThis.fetch as unknown as FetchFn)
  }

  private async gql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const res = await this.fetch(LINEAR_GQL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.apiKey,
      },
      body: JSON.stringify({ query, variables }),
    })

    if (!res.ok) {
      throw new Error(`Linear API error: HTTP ${res.status}`)
    }

    const body = (await res.json()) as { data?: T; errors?: { message: string }[] }
    if (body.errors?.length) {
      throw new Error(`Linear GraphQL error: ${body.errors[0].message}`)
    }
    if (!body.data) {
      throw new Error('Linear API returned no data')
    }
    return body.data
  }

  /** Fetch a single issue by its human-readable identifier (e.g. "ENG-123"). */
  async getTicket(identifier: string): Promise<LinearTicket | null> {
    const data = await this.gql<{
      issues: { nodes: Record<string, unknown>[] }
    }>(
      `query IssueByIdentifier($identifier: String!) {
        issues(filter: { identifier: { eq: $identifier } }) {
          nodes { ${ISSUE_FIELDS} }
        }
      }`,
      { identifier },
    )
    const node = data.issues.nodes[0]
    return node ? shapedTicket(node) : null
  }

  /** Update the workflow state of an issue by its internal UUID. */
  async updateTicketStatus(issueId: string, stateId: string): Promise<boolean> {
    const data = await this.gql<{ issueUpdate: { success: boolean } }>(
      `mutation UpdateStatus($issueId: String!, $stateId: String!) {
        issueUpdate(id: $issueId, input: { stateId: $stateId }) {
          success
        }
      }`,
      { issueId, stateId },
    )
    return data.issueUpdate.success
  }

  /** List all workflow states for a team. */
  async getWorkflowStates(teamId: string): Promise<LinearWorkflowState[]> {
    const data = await this.gql<{
      workflowStates: { nodes: LinearWorkflowState[] }
    }>(
      `query WorkflowStates($teamId: String!) {
        workflowStates(filter: { team: { id: { eq: $teamId } } }) {
          nodes { id name type }
        }
      }`,
      { teamId },
    )
    return data.workflowStates.nodes
  }

  /** List open issues for a team, optionally filtered to a cycle. */
  async getTeamIssues(teamId: string, cycleId?: string): Promise<LinearTicket[]> {
    const filter: Record<string, unknown> = { team: { id: { eq: teamId } } }
    if (cycleId) {
      filter['cycle'] = { id: { eq: cycleId } }
    }

    const data = await this.gql<{
      issues: { nodes: Record<string, unknown>[] }
    }>(
      `query TeamIssues($filter: IssueFilter!) {
        issues(filter: $filter) {
          nodes { ${ISSUE_FIELDS} }
        }
      }`,
      { filter },
    )
    return data.issues.nodes.map(shapedTicket)
  }
}

export function createLinearClient(apiKey: string, fetchFn?: FetchFn): LinearClient {
  return new LinearClient(apiKey, fetchFn)
}
