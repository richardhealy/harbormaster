import { LinearClient } from "@linear/sdk";

export interface LinearConfig {
  apiKey: string;
}

let client: LinearClient | null = null;

/**
 * Returns a singleton Linear client. Initialises on first call.
 */
export function getLinearClient(config?: LinearConfig): LinearClient {
  if (!client) {
    const apiKey = config?.apiKey ?? process.env["LINEAR_API_KEY"];
    if (!apiKey) {
      throw new Error("LINEAR_API_KEY environment variable is required");
    }
    client = new LinearClient({ apiKey });
  }
  return client;
}

export interface LinearTicket {
  id: string;
  linearId: string;
  title: string;
  description?: string;
  status: string;
  priority: number;
  labels: string[];
  assigneeId?: string;
}

/**
 * Fetches a Linear issue by its identifier (e.g. "ENG-123") and
 * normalises it to the harbormaster ticket shape.
 */
export async function fetchTicket(
  client: LinearClient,
  identifier: string
): Promise<LinearTicket | null> {
  const issue = await client.issue(identifier);
  if (!issue) return null;

  const state = await issue.state;
  const assignee = await issue.assignee;
  const labels = await issue.labels();

  return {
    id: issue.id,
    linearId: issue.identifier,
    title: issue.title,
    description: issue.description ?? undefined,
    status: state?.name ?? "unknown",
    priority: issue.priority,
    labels: labels.nodes.map((l) => l.name),
    assigneeId: assignee?.id,
  };
}

/**
 * Updates the status of a Linear issue.
 */
export async function updateTicketStatus(
  client: LinearClient,
  issueId: string,
  stateId: string
): Promise<void> {
  await client.updateIssue(issueId, { stateId });
}
