import { describe, it, expect, beforeEach } from 'vitest'
import { createMcpServer } from '../../src/agent-iface/mcp/server'
import { resetHotspotManager } from '../../src/agent-iface/commands'

const EXPECTED_TOOLS = [
  'schedule_plan',
  'hotspot_check',
  'hotspot_register',
  'hotspot_acquire',
  'hotspot_release',
  'hotspot_release_by_holder',
  'hotspot_list_active',
  'gate_run',
  'provenance_record',
  'provenance_query',
  'release_create',
  'release_list',
  'release_manifest',
  'release_notes',
]

describe('createMcpServer', () => {
  beforeEach(() => {
    resetHotspotManager()
  })

  it('registers one tool per agent command', async () => {
    const server = createMcpServer()
    const tools = await listToolNames(server)
    expect(tools.sort()).toEqual([...EXPECTED_TOOLS].sort())
  })

  it('runs the schedule_plan tool end-to-end through the registered handler', async () => {
    const server = createMcpServer()
    const tool = getRegisteredTool(server, 'schedule_plan')
    const result = await tool.handler(
      { tickets: [{ ticketId: 'ENG-1', title: 'Fix bug', expectedFiles: ['src/x.ts'] }] },
      {} as never,
    )
    expect(result.isError).toBeFalsy()
    const payload = JSON.parse(result.content[0].text)
    expect(payload.ticketCount).toBe(1)
  })

  it('surfaces validation errors as tool errors rather than throwing', async () => {
    const server = createMcpServer()
    const tool = getRegisteredTool(server, 'hotspot_check')
    const result = await tool.handler({ files: [] }, {} as never)
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Invalid input')
  })
})

// `_registeredTools` is a private field on McpServer; reach into it for unit
// testing rather than spinning up a real stdio/in-memory transport per test.
function getRegisteredTool(server: ReturnType<typeof createMcpServer>, name: string): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools = (server as any)._registeredTools
  const tool = tools[name]
  if (!tool) throw new Error(`tool ${name} not registered`)
  return tool
}

async function listToolNames(server: ReturnType<typeof createMcpServer>): Promise<string[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return Object.keys((server as any)._registeredTools)
}
