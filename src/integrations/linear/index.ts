import type { LinearTicket, LinearLabel, LinearWorkflowState, LinearIssueFilter } from './types'

export type { LinearTicket, LinearWorkflowState, LinearIssueFilter }
export type { LinearState, LinearLabel, LinearUser } from './types'

/** Minimal subset of the `fetch` signature the client needs; injectable so tests can stub HTTP. */
export type FetchFn = (
  url: string,
  init: RequestInit,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

const GRAPHQL_URL = 'https://api.linear.app/graphql'

// GraphQL connection fields on the wire: `labels { nodes: [...] }`
interface RawIssue extends Omit<LinearTicket, 'labels'> {
  labels: { nodes: LinearLabel[] } | LinearLabel[]
}

function normaliseTicket(raw: RawIssue): LinearTicket {
  const labels = Array.isArray(raw.labels)
    ? raw.labels
    : (raw.labels as { nodes: LinearLabel[] }).nodes ?? []
  return { ...raw, labels }
}

/**
 * Thin client over Linear's GraphQL API. Every method throws on a non-OK
 * HTTP response or a GraphQL `errors` array, so callers don't need to
 * separately check response shape. `fetchFn` defaults to the global `fetch`
 * but is injectable for deterministic testing.
 */
export class LinearClient {
  private readonly apiKey: string
  private readonly fetchFn: FetchFn
  private readonly url: string

  constructor(apiKey: string, fetchFn?: FetchFn, url = GRAPHQL_URL) {
    this.apiKey = apiKey
    this.fetchFn = fetchFn ?? (globalThis.fetch as unknown as FetchFn)
    this.url = url
  }

  /** Issues a single GraphQL request and unwraps `data`, throwing on transport or GraphQL errors. */
  private async gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const res = await this.fetchFn(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.apiKey,
      },
      body: JSON.stringify({ query, variables }),
    })

    if (!res.ok) {
      throw new Error(`Linear API returned HTTP ${res.status}`)
    }

    const body = (await res.json()) as { data?: T; errors?: { message: string }[] }

    if (body.errors?.length) {
      throw new Error(`Linear GraphQL error: ${body.errors[0].message}`)
    }
    if (body.data === undefined) {
      throw new Error('Linear API returned no data')
    }
    return body.data
  }

  /** Fetches one issue by id or human-readable identifier (e.g. `ENG-123`); `null` if not found. */
  async getTicket(identifier: string): Promise<LinearTicket | null> {
    const data = await this.gql<{ issue: RawIssue | null }>(
      `query GetIssue($identifier: String!) {
        issue(id: $identifier) {
          id identifier title description priority url createdAt updatedAt
          state { id name type }
          labels { nodes { id name } }
          assignee { id name email }
        }
      }`,
      { identifier },
    )
    return data.issue ? normaliseTicket(data.issue) : null
  }

  /** Moves a ticket to a different workflow state (see {@link getWorkflowStates} for valid ids). */
  async updateTicketStatus(ticketId: string, stateId: string): Promise<void> {
    await this.gql<{ issueUpdate: { success: boolean } }>(
      `mutation UpdateIssue($id: String!, $stateId: String!) {
        issueUpdate(id: $id, input: { stateId: $stateId }) { success }
      }`,
      { id: ticketId, stateId },
    )
  }

  /** Lists a team's issues, newest-first server-side ordering, optionally filtered (defaults to 50). */
  async listTeamIssues(
    teamId: string,
    options: { limit?: number; filter?: LinearIssueFilter } = {},
  ): Promise<LinearTicket[]> {
    const { limit = 50, filter } = options
    const data = await this.gql<{ team: { issues: { nodes: RawIssue[] } } }>(
      `query ListIssues($teamId: String!, $limit: Int!, $filter: IssueFilter) {
        team(id: $teamId) {
          issues(first: $limit, filter: $filter) {
            nodes {
              id identifier title description priority url createdAt updatedAt
              state { id name type }
              labels { nodes { id name } }
              assignee { id name email }
            }
          }
        }
      }`,
      { teamId, limit, filter },
    )
    return (data.team?.issues?.nodes ?? []).map(normaliseTicket)
  }

  /** Returns every workflow state configured for a team, used to resolve ids for {@link updateTicketStatus}. */
  async getWorkflowStates(teamId: string): Promise<LinearWorkflowState[]> {
    const data = await this.gql<{ workflowStates: { nodes: LinearWorkflowState[] } }>(
      `query GetWorkflowStates($teamId: String!) {
        workflowStates(filter: { team: { id: { eq: $teamId } } }) {
          nodes { id name type color }
        }
      }`,
      { teamId },
    )
    return data.workflowStates?.nodes ?? []
  }
}
