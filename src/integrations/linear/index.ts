import type { LinearTicket, LinearLabel, LinearWorkflowState, LinearIssueFilter } from './types'

export type { LinearTicket, LinearWorkflowState, LinearIssueFilter }
export type { LinearState, LinearLabel, LinearUser } from './types'

/**
 * Signature-compatible subset of the `fetch` API. Injected into
 * `LinearClient` so tests can supply a fake implementation instead of
 * making real network calls; defaults to the global `fetch` at runtime.
 */
export type FetchFn = (
  url: string,
  init: RequestInit,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

const GRAPHQL_URL = 'https://api.linear.app/graphql'

// GraphQL connection fields on the wire: `labels { nodes: [...] }`
interface RawIssue extends Omit<LinearTicket, 'labels'> {
  labels: { nodes: LinearLabel[] } | LinearLabel[]
}

/**
 * Flattens Linear's GraphQL connection shape (`labels: { nodes: [...] }`)
 * into the plain `LinearLabel[]` used by `LinearTicket`, so the rest of the
 * codebase doesn't need to know about Linear's connection/edge wire format.
 */
function normaliseTicket(raw: RawIssue): LinearTicket {
  const labels = Array.isArray(raw.labels)
    ? raw.labels
    : (raw.labels as { nodes: LinearLabel[] }).nodes ?? []
  return { ...raw, labels }
}

/**
 * Thin client over Linear's GraphQL API. Takes an injectable `FetchFn` so
 * it can be unit tested without a real network connection.
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

  /**
   * Fetches a single Linear issue, accepting either its internal id or its
   * human-readable identifier (e.g. `ENG-123`). Returns `null` rather than
   * throwing when the issue doesn't exist, since "not found" is an expected
   * outcome for callers (e.g. tickets referenced by stale data).
   */
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

  /**
   * Moves a Linear issue to a different workflow state via the `issueUpdate`
   * mutation. Callers must resolve the target state name to a `stateId`
   * first, e.g. via `getWorkflowStates`.
   */
  async updateTicketStatus(ticketId: string, stateId: string): Promise<void> {
    await this.gql<{ issueUpdate: { success: boolean } }>(
      `mutation UpdateIssue($id: String!, $stateId: String!) {
        issueUpdate(id: $id, input: { stateId: $stateId }) { success }
      }`,
      { id: ticketId, stateId },
    )
  }

  /**
   * Lists issues belonging to a team, optionally bounded by `limit` (default
   * 50) and narrowed by `filter`. Used by `TicketSyncer.syncTeamTickets` to
   * pull a whole team's tickets in one call for mirroring into the local
   * `tickets` table.
   */
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

  /**
   * Returns a team's configured workflow states (e.g. "Todo", "In Progress",
   * "Done"), used to resolve human-readable status names to the state ids
   * required by `updateTicketStatus`.
   */
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
