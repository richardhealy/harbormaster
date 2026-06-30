import { describe, it, expect } from 'vitest'
import { McpServer } from '../../src/agent-iface/mcp/server'
import { createTools } from '../../src/agent-iface/mcp/tools'
import type { ProvenancePool } from '../../src/provenance'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a server backed by the default (no external deps) tool set. */
function makeServer(provenance?: ProvenancePool) {
  const tools = createTools({ provenance })
  return new McpServer(tools)
}

function req(id: number, method: string, params?: unknown) {
  return JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })
}

async function call(server: McpServer, line: string) {
  const raw = await server.handle(line)
  expect(raw).not.toBeNull()
  return JSON.parse(raw!)
}

// ---------------------------------------------------------------------------
// JSON-RPC protocol
// ---------------------------------------------------------------------------

describe('McpServer — protocol', () => {
  it('responds to initialize with server info and capabilities', async () => {
    const server = makeServer()
    const res = await call(server, req(1, 'initialize'))
    expect(res.id).toBe(1)
    expect(res.result.serverInfo.name).toBe('harbormaster')
    expect(res.result.capabilities.tools).toBeDefined()
    expect(res.result.protocolVersion).toBeTruthy()
  })

  it('responds to ping with empty result', async () => {
    const server = makeServer()
    const res = await call(server, req(2, 'ping'))
    expect(res.id).toBe(2)
    expect(res.result).toEqual({})
  })

  it('returns PARSE_ERROR for invalid JSON', async () => {
    const server = makeServer()
    const raw = await server.handle('{not json')
    expect(raw).not.toBeNull()
    const res = JSON.parse(raw!)
    expect(res.error.code).toBe(-32700)
    expect(res.id).toBeNull()
  })

  it('returns METHOD_NOT_FOUND for an unknown method', async () => {
    const server = makeServer()
    const res = await call(server, req(3, 'no_such_method'))
    expect(res.error.code).toBe(-32601)
  })

  it('returns null for a notification (no id in input)', async () => {
    const server = makeServer()
    const line = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
    const raw = await server.handle(line)
    expect(raw).toBeNull()
  })

  it('returns null for empty / blank lines', async () => {
    const server = makeServer()
    expect(await server.handle('')).toBeNull()
    expect(await server.handle('   ')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// tools/list
// ---------------------------------------------------------------------------

describe('McpServer — tools/list', () => {
  it('lists all six harbormaster tools', async () => {
    const server = makeServer()
    const res = await call(server, req(4, 'tools/list'))
    expect(res.result.tools).toHaveLength(6)
    const names = (res.result.tools as Array<{ name: string }>).map(t => t.name)
    expect(names).toContain('hm_schedule')
    expect(names).toContain('hm_estimate_impact')
    expect(names).toContain('hm_check_hotspot')
    expect(names).toContain('hm_acquire_lease')
    expect(names).toContain('hm_release_lease')
    expect(names).toContain('hm_get_trail')
  })

  it('every tool has a name, description, and inputSchema', async () => {
    const server = makeServer()
    const res = await call(server, req(5, 'tools/list'))
    for (const tool of res.result.tools as Array<{ name: string; description: string; inputSchema: unknown }>) {
      expect(tool.name).toBeTruthy()
      expect(tool.description).toBeTruthy()
      expect(tool.inputSchema).toBeDefined()
    }
  })
})

// ---------------------------------------------------------------------------
// tools/call — individual tools
// ---------------------------------------------------------------------------

function toolCall(id: number, name: string, args: Record<string, unknown>) {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name, arguments: args },
  })
}

describe('hm_schedule', () => {
  it('produces a dispatch plan for given ticket IDs', async () => {
    const server = makeServer()
    const res = await call(server, toolCall(10, 'hm_schedule', { tickets: ['ENG-1', 'ENG-2'] }))
    const plan = JSON.parse(res.result.content[0].text)
    expect(plan.ticketCount).toBe(2)
    expect(Array.isArray(plan.waves)).toBe(true)
  })

  it('returns an error for empty tickets array', async () => {
    const server = makeServer()
    const res = await call(server, toolCall(11, 'hm_schedule', { tickets: [] }))
    expect(res.result.isError).toBe(true)
    const body = JSON.parse(res.result.content[0].text)
    expect(body.error).toMatch(/non-empty/)
  })
})

describe('hm_estimate_impact', () => {
  it('returns impact surface with confidence 1.0 for explicit files', async () => {
    const server = makeServer()
    const res = await call(server, toolCall(20, 'hm_estimate_impact', {
      ticketId: 'ENG-3',
      expectedFiles: ['src/release/branch.ts'],
    }))
    const surface = JSON.parse(res.result.content[0].text)
    expect(surface.confidence).toBe(1.0)
    expect(surface.ticketId).toBe('ENG-3')
  })

  it('returns an error when ticketId is missing', async () => {
    const server = makeServer()
    const res = await call(server, toolCall(21, 'hm_estimate_impact', {}))
    expect(res.result.isError).toBe(true)
  })
})

describe('hm_check_hotspot', () => {
  it('returns touchesHotspot: false when no hotspots are configured', async () => {
    const server = makeServer()
    const res = await call(server, toolCall(30, 'hm_check_hotspot', { files: ['src/scheduler/index.ts'] }))
    const result = JSON.parse(res.result.content[0].text)
    expect(result.touchesHotspot).toBe(false)
    expect(result.matches).toHaveLength(0)
  })
})

describe('hm_acquire_lease', () => {
  it('returns not-required when no hotspots are registered', async () => {
    const server = makeServer()
    const res = await call(server, toolCall(40, 'hm_acquire_lease', {
      dispatchId: 'agent-1',
      files: ['src/impact/index.ts'],
    }))
    const result = JSON.parse(res.result.content[0].text)
    expect(result.status).toBe('not-required')
  })

  it('returns error when dispatchId is missing', async () => {
    const server = makeServer()
    const res = await call(server, toolCall(41, 'hm_acquire_lease', { files: ['src/a.ts'] }))
    expect(res.result.isError).toBe(true)
  })
})

describe('hm_release_lease', () => {
  it('returns released: false for an unknown lease ID', async () => {
    const server = makeServer()
    const res = await call(server, toolCall(50, 'hm_release_lease', { leaseId: 'unknown-lease-id' }))
    const result = JSON.parse(res.result.content[0].text)
    expect(result.released).toBe(false)
  })

  it('returns error when leaseId is missing', async () => {
    const server = makeServer()
    const res = await call(server, toolCall(51, 'hm_release_lease', {}))
    expect(res.result.isError).toBe(true)
  })
})

describe('hm_get_trail', () => {
  it('returns error when no provenance pool is configured', async () => {
    const server = makeServer()
    const res = await call(server, toolCall(60, 'hm_get_trail', { ticketId: 'ENG-1' }))
    expect(res.result.isError).toBe(true)
    const body = JSON.parse(res.result.content[0].text)
    expect(body.error).toMatch(/DATABASE_URL/)
  })

  it('returns events from the provenance pool', async () => {
    const pool: ProvenancePool = { query: () => Promise.resolve({ rows: [] }) }
    const server = makeServer(pool)
    const res = await call(server, toolCall(61, 'hm_get_trail', { ticketId: 'ENG-1' }))
    expect(res.result.isError).toBeUndefined()
    const events = JSON.parse(res.result.content[0].text)
    expect(Array.isArray(events)).toBe(true)
  })
})

describe('tools/call — error handling', () => {
  it('returns METHOD_NOT_FOUND for an unknown tool name', async () => {
    const server = makeServer()
    const res = await call(server, toolCall(70, 'hm_nonexistent_tool', {}))
    expect(res.error.code).toBe(-32601)
    expect(res.error.message).toContain('hm_nonexistent_tool')
  })

  it('returns INVALID_PARAMS when params.name is missing', async () => {
    const server = makeServer()
    const line = JSON.stringify({ jsonrpc: '2.0', id: 71, method: 'tools/call', params: {} })
    const res = await call(server, line)
    expect(res.error.code).toBe(-32602)
  })
})
