import { logger } from '../../logger';

export interface LinearTicket {
  id: string;
  title: string;
  status: string;
  priority: number;
  url: string;
  teamId: string;
  cycleId?: string;
  projectId?: string;
  labels: string[];
}

export interface LinearRelease {
  id: string;
  name: string;
  status: string;
  targetDate?: string;
  issueIds: string[];
}

export class LinearClient {
  private readonly baseUrl = 'https://api.linear.app/graphql';

  constructor(private readonly apiKey: string) {}

  async getTicket(ticketId: string): Promise<LinearTicket | null> {
    try {
      const result = await this.query<{ issue: LinearTicket | null }>(
        `query { issue(id: "${ticketId}") { id title status { name } priority url team { id } labels { nodes { name } } } }`,
      );
      return result.issue;
    } catch (err) {
      logger.warn('Failed to fetch Linear ticket', { ticketId, err });
      return null;
    }
  }

  async updateTicketStatus(ticketId: string, statusName: string): Promise<boolean> {
    try {
      await this.query(
        `mutation { issueUpdate(id: "${ticketId}", input: { stateId: "${statusName}" }) { success } }`,
      );
      return true;
    } catch (err) {
      logger.warn('Failed to update Linear ticket status', { ticketId, statusName, err });
      return false;
    }
  }

  async getRelease(releaseId: string): Promise<LinearRelease | null> {
    try {
      const result = await this.query<{ cycle: LinearRelease | null }>(
        `query { cycle(id: "${releaseId}") { id name status targetDate issues { nodes { id } } } }`,
      );
      return result.cycle;
    } catch (err) {
      logger.warn('Failed to fetch Linear release', { releaseId, err });
      return null;
    }
  }

  private async query<T>(queryString: string): Promise<T> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.apiKey,
      },
      body: JSON.stringify({ query: queryString }),
    });

    if (!response.ok) {
      throw new Error(`Linear API error: ${response.status} ${response.statusText}`);
    }

    const body = await response.json() as { data?: T; errors?: Array<{ message: string }> };

    if (body.errors?.length) {
      throw new Error(`Linear GraphQL error: ${body.errors[0].message}`);
    }

    return body.data as T;
  }
}

export function createLinearClient(): LinearClient | null {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    logger.warn('LINEAR_API_KEY not set; Linear integration disabled.');
    return null;
  }
  return new LinearClient(apiKey);
}
