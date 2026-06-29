import type { LinearTicket, LinearCycle } from './types';

export class LinearClient {
  private apiKey: string;
  private baseUrl = 'https://api.linear.app/graphql';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const resp = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.apiKey,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!resp.ok) {
      throw new Error(`Linear API error: ${resp.status} ${resp.statusText}`);
    }
    const json = await resp.json() as { data: T; errors?: unknown[] };
    if (json.errors?.length) {
      throw new Error(`Linear GraphQL error: ${JSON.stringify(json.errors)}`);
    }
    return json.data;
  }

  async getTicket(id: string): Promise<LinearTicket> {
    const data = await this.gql<{ issue: LinearTicket }>(`
      query Issue($id: String!) {
        issue(id: $id) {
          id title
          state { name }
          assignee { name }
          labels { nodes { name } }
          branchName
          cycle { id }
        }
      }`, { id });
    return data.issue;
  }

  async updateTicketStatus(id: string, stateId: string): Promise<void> {
    await this.gql(`
      mutation UpdateIssue($id: String!, $stateId: String!) {
        issueUpdate(id: $id, input: { stateId: $stateId }) {
          success
        }
      }`, { id, stateId });
  }

  async getCycle(id: string): Promise<LinearCycle> {
    const data = await this.gql<{ cycle: LinearCycle }>(`
      query Cycle($id: String!) {
        cycle(id: $id) {
          id name number startsAt endsAt
          issues { nodes { id } }
        }
      }`, { id });
    return data.cycle;
  }

  async listTicketsInCycle(cycleId: string): Promise<LinearTicket[]> {
    const data = await this.gql<{ cycle: { issues: { nodes: LinearTicket[] } } }>(`
      query CycleIssues($id: String!) {
        cycle(id: $id) {
          issues { nodes { id title state { name } branchName } }
        }
      }`, { id: cycleId });
    return data.cycle.issues.nodes;
  }
}
