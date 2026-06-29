export interface CLICommand {
  name: string;
  description: string;
  args: string[];
  handler: (args: Record<string, string>) => Promise<void>;
}

export interface AgentRequest {
  command: 'dispatch' | 'status' | 'complete' | 'list-tickets';
  ticketId?: string;
  agentId: string;
  payload?: Record<string, unknown>;
}

export interface AgentResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}

export async function handleAgentRequest(
  req: AgentRequest,
  serviceUrl: string
): Promise<AgentResponse> {
  const url = `${serviceUrl}/agent/${req.command}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });

  if (!response.ok) {
    return { success: false, error: `HTTP ${response.status}` };
  }

  const data = await response.json();
  return { success: true, data };
}

export function formatDispatchPlan(plan: unknown): string {
  const p = plan as { decisions?: Array<{ ticketId: string; action: string; reason: string }> };
  if (!p.decisions?.length) return 'No tickets to dispatch.';

  const lines = ['Dispatch Plan:', ''];
  for (const d of p.decisions) {
    const symbol = d.action === 'parallel' ? '⟹' : d.action === 'sequence' ? '⟶' : '⊕';
    lines.push(`  ${symbol} [${d.action.toUpperCase()}] ${d.ticketId}`);
    lines.push(`     ${d.reason}`);
  }
  return lines.join('\n');
}
