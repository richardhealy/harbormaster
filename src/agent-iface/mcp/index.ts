export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface MCPToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export const HARBORMASTER_MCP_TOOLS: MCPTool[] = [
  {
    name: 'dispatch_ticket',
    description: 'Dispatch a Linear ticket for agent work. Returns the dispatch plan including scheduling decisions.',
    inputSchema: {
      type: 'object',
      required: ['ticketId', 'agentId'],
      properties: {
        ticketId: { type: 'string', description: 'Linear ticket ID (e.g. ENG-123)' },
        agentId: { type: 'string', description: 'Unique agent identifier' },
        domain: { type: 'string', description: 'Domain/area of work (docs, feature, migration, etc.)' },
      },
    },
  },
  {
    name: 'complete_ticket',
    description: 'Mark a ticket as complete and enter the integration queue.',
    inputSchema: {
      type: 'object',
      required: ['ticketId', 'agentId', 'branch', 'headSha'],
      properties: {
        ticketId: { type: 'string' },
        agentId: { type: 'string' },
        branch: { type: 'string', description: 'The branch containing the work' },
        headSha: { type: 'string', description: 'Current HEAD SHA of the branch' },
      },
    },
  },
  {
    name: 'get_ticket_status',
    description: 'Get the current status of a ticket including gate results.',
    inputSchema: {
      type: 'object',
      required: ['ticketId'],
      properties: {
        ticketId: { type: 'string' },
      },
    },
  },
  {
    name: 'create_release',
    description: 'Create a new release branch from the current main.',
    inputSchema: {
      type: 'object',
      required: ['bumpType'],
      properties: {
        bumpType: { type: 'string', enum: ['major', 'minor', 'patch'] },
        preId: { type: 'string', description: 'Pre-release identifier (e.g. beta)' },
      },
    },
  },
  {
    name: 'acquire_hotspot_lease',
    description: 'Acquire an advisory lease on a hotspot resource (e.g. migrations).',
    inputSchema: {
      type: 'object',
      required: ['resource', 'ticketId', 'agentId'],
      properties: {
        resource: { type: 'string', description: 'Hotspot resource identifier' },
        ticketId: { type: 'string' },
        agentId: { type: 'string' },
      },
    },
  },
  {
    name: 'release_hotspot_lease',
    description: 'Release an advisory lease on a hotspot resource.',
    inputSchema: {
      type: 'object',
      required: ['resource', 'ticketId'],
      properties: {
        resource: { type: 'string' },
        ticketId: { type: 'string' },
      },
    },
  },
];

export function handleMCPToolCall(
  call: MCPToolCall,
  handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>>
): Promise<MCPToolResult> {
  const handler = handlers[call.name];
  if (!handler) {
    return Promise.resolve({
      content: [{ type: 'text' as const, text: `Unknown tool: ${call.name}` }],
      isError: true,
    });
  }

  return handler(call.arguments)
    .then((result) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }))
    .catch((err: Error) => ({
      content: [{ type: 'text' as const, text: err.message }],
      isError: true,
    }));
}
