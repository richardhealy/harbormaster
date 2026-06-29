import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../../config';

export interface LinearTicket {
  id: string;
  title: string;
  description?: string;
  state: string;
  priority: number;
  assigneeId?: string;
  teamId: string;
  branchName?: string;
}

export interface LinearRelease {
  id: string;
  name: string;
  targetDate?: string;
  status: string;
}

export class LinearClient {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.linear.app/graphql';

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? config.linear.apiKey;
  }

  private async gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': this.apiKey,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(`Linear API error: ${response.status} ${response.statusText}`);
    }

    const json = await response.json() as { data?: T; errors?: Array<{ message: string }> };
    if (json.errors?.length) {
      throw new Error(`Linear GraphQL error: ${json.errors.map((e) => e.message).join(', ')}`);
    }

    return json.data as T;
  }

  async getTicket(id: string): Promise<LinearTicket> {
    const data = await this.gql<{ issue: LinearTicket }>(`
      query GetIssue($id: String!) {
        issue(id: $id) {
          id
          title
          description
          state { name }
          priority
          assignee { id }
          team { id }
          branchName
        }
      }
    `, { id });
    return data.issue;
  }

  async updateTicketState(id: string, stateId: string): Promise<void> {
    await this.gql(`
      mutation UpdateIssue($id: String!, $stateId: String!) {
        issueUpdate(id: $id, input: { stateId: $stateId }) {
          success
        }
      }
    `, { id, stateId });
  }

  async addComment(issueId: string, body: string): Promise<void> {
    await this.gql(`
      mutation CreateComment($issueId: String!, $body: String!) {
        commentCreate(input: { issueId: $issueId, body: $body }) {
          success
        }
      }
    `, { issueId, body });
  }

  async getTeamStates(teamId: string): Promise<Array<{ id: string; name: string; type: string }>> {
    const data = await this.gql<{
      team: { states: { nodes: Array<{ id: string; name: string; type: string }> } };
    }>(`
      query GetTeamStates($teamId: String!) {
        team(id: $teamId) {
          states { nodes { id name type } }
        }
      }
    `, { teamId });
    return data.team.states.nodes;
  }
}

export function verifyLinearWebhook(body: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}
