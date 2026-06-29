import { HARBORMASTER_MCP_TOOLS, handleMCPToolCall } from '../src/agent-iface/mcp';

describe('HARBORMASTER_MCP_TOOLS', () => {
  it('exports the expected tools', () => {
    const names = HARBORMASTER_MCP_TOOLS.map((t) => t.name);
    expect(names).toContain('dispatch_ticket');
    expect(names).toContain('complete_ticket');
    expect(names).toContain('get_ticket_status');
    expect(names).toContain('create_release');
    expect(names).toContain('acquire_hotspot_lease');
    expect(names).toContain('release_hotspot_lease');
  });

  it('each tool has a name, description, and inputSchema', () => {
    for (const tool of HARBORMASTER_MCP_TOOLS) {
      expect(typeof tool.name).toBe('string');
      expect(typeof tool.description).toBe('string');
      expect(typeof tool.inputSchema).toBe('object');
    }
  });
});

describe('handleMCPToolCall', () => {
  it('returns error for unknown tool', async () => {
    const result = await handleMCPToolCall({ name: 'unknown_tool', arguments: {} }, {});
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Unknown tool');
  });

  it('calls the correct handler', async () => {
    const handlers = {
      dispatch_ticket: async (args: Record<string, unknown>) => ({
        ticketId: args['ticketId'],
        dispatched: true,
      }),
    };
    const result = await handleMCPToolCall(
      { name: 'dispatch_ticket', arguments: { ticketId: 'ENG-123', agentId: 'a1' } },
      handlers
    );
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.ticketId).toBe('ENG-123');
    expect(parsed.dispatched).toBe(true);
  });

  it('returns error when handler throws', async () => {
    const handlers = {
      dispatch_ticket: async () => {
        throw new Error('handler error');
      },
    };
    const result = await handleMCPToolCall(
      { name: 'dispatch_ticket', arguments: {} },
      handlers
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('handler error');
  });
});
