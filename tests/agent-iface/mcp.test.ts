import { describe, it, expect } from 'vitest'
import { MCPServer } from '../../src/agent-iface/mcp/server'
import { buildTools } from '../../src/agent-iface/mcp/tools'
import type { MCPServices } from '../../src/agent-iface/mcp/tools'
import { ImpactEstimator } from '../../src/impact'
import { Scheduler } from '../../src/scheduler'
import { createHotspotLeaseManager } from '../../src/hotspots'
import type { Hotspot } from '../../src/hotspots/types'
import type { JSONRPCRequest } from '../../src/agent-iface/mcp/types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MIGRATION_HOTSPOT: Hotspot = {
  name: 'db-migrations',
  patterns: ['src/db/migrations/'],
  reason: 'Database migrations must not run concurrently',
}

function makeServices(): MCPServices {
  return {
    impactEstimator: new ImpactEstimator(),
    scheduler: new Scheduler(),
    leaseManager: createHotspotLeaseManager([MIGRATION_HOTSPOT]),
  }
}

function makeServer(services?: MCPServices): MCPServer {
  return new MCPServer(buildTools(services ?? makeServices()))
}

function req(method: string, params?: unknown, id: number = 1): JSONRPCRequest {
  return { jsonrpc: '2.0', id, method, params }
}

// ---------------------------------------------------------------------------
// Server protocol
// ---------------------------------------------------------------------------

describe('MCPServer — protocol', () => {
  it('responds to initialize with server info', async () => {
    const server = makeServer()
    const response = await server.handleMessage(req('initialize', { protocolVersion: '2024-11-05' }))
    expect(response).not.toBeNull()
    expect(response?.result).toMatchObject({
      protocolVersion: '2024-11-05',
      serverInfo: { name: 'harbormaster' },
      capabilities: { tools: {} },
    })
  })

  it('lists all registered tools', async () => {
    const server = makeServer()
    const response = await server.handleMessage(req('tools/list'))
    const tools = (response?.result as { tools: Array<{ name: string }> }).tools
    const names = tools.map((t) => t.name)
    expect(names).toContain('schedule_tickets')
    expect(names).toContain('check_hotspot')
    expect(names).toContain('acquire_lease')
    expect(names).toContain('release_lease')
    expect(names).toContain('release_leases_by_holder')
    expect(names).toContain('list_active_leases')
  })

  it('returns error for unknown method', async () => {
    const server = makeServer()
    const response = await server.handleMessage(req('unknown/method'))
    expect(response?.error?.code).toBe(-32601)
    expect(response?.error?.message).toMatch(/Method not found/)
  })

  it('returns error for unknown tool', async () => {
    const server = makeServer()
    const response = await server.handleMessage(
      req('tools/call', { name: 'nonexistent_tool', arguments: {} }),
    )
    expect(response?.error?.code).toBe(-32601)
    expect(response?.error?.message).toMatch(/Unknown tool/)
  })

  it('returns null for notifications/initialized', async () => {
    const server = makeServer()
    const response = await server.handleMessage({
      jsonrpc: '2.0',
      id: null,
      method: 'notifications/initialized',
    })
    expect(response).toBeNull()
  })

  it('preserves the request id in responses', async () => {
    const server = makeServer()
    const response = await server.handleMessage(req('initialize', {}, 42))
    expect(response?.id).toBe(42)
  })
})

// ---------------------------------------------------------------------------
// schedule_tickets tool
// ---------------------------------------------------------------------------

describe('schedule_tickets tool', () => {
  it('returns an error for empty tickets array', async () => {
    const server = makeServer()
    const response = await server.handleMessage(
      req('tools/call', { name: 'schedule_tickets', arguments: { tickets: [] } }),
    )
    const result = response?.result as { isError?: boolean; content: Array<{ text: string }> }
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/non-empty/)
  })

  it('schedules a single ticket and returns a plan', async () => {
    const server = makeServer()
    const response = await server.handleMessage(
      req('tools/call', {
        name: 'schedule_tickets',
        arguments: {
          tickets: [{ ticketId: 'ENG-1', title: 'Fix auth bug', labels: ['bug'] }],
        },
      }),
    )
    const result = response?.result as { content: Array<{ text: string }> }
    const data = JSON.parse(result.content[0].text)
    expect(data.plan.waves).toHaveLength(1)
    expect(data.plan.ticketCount).toBe(1)
    expect(data.surfaces[0].ticketId).toBe('ENG-1')
  })

  it('uses expectedFiles for high-confidence surface', async () => {
    const server = makeServer()
    const response = await server.handleMessage(
      req('tools/call', {
        name: 'schedule_tickets',
        arguments: {
          tickets: [
            {
              ticketId: 'ENG-2',
              title: 'Migrate DB',
              expectedFiles: ['src/db/migrations/003.sql', 'src/db/schema.ts'],
            },
          ],
        },
      }),
    )
    const result = response?.result as { content: Array<{ text: string }> }
    const data = JSON.parse(result.content[0].text)
    expect(data.surfaces[0].confidence).toBe(1.0)
    expect(data.surfaces[0].files).toContain('src/db/migrations/003.sql')
  })

  it('schedules two overlapping tickets in separate waves', async () => {
    const server = makeServer()
    const response = await server.handleMessage(
      req('tools/call', {
        name: 'schedule_tickets',
        arguments: {
          tickets: [
            { ticketId: 'T1', title: 'Edit A', expectedFiles: ['src/shared/contract.ts', 'src/shared/types.ts'] },
            { ticketId: 'T2', title: 'Edit B', expectedFiles: ['src/shared/contract.ts', 'src/shared/util.ts'] },
          ],
        },
      }),
    )
    const result = response?.result as { content: Array<{ text: string }> }
    const data = JSON.parse(result.content[0].text)
    // Both share contract.ts → high overlap → sequence or merge
    const allDecisions = data.plan.waves.flat().map((g: { decision: string }) => g.decision)
    expect(allDecisions.some((d: string) => d === 'merge' || d === 'sequence')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// check_hotspot tool
// ---------------------------------------------------------------------------

describe('check_hotspot tool', () => {
  it('detects hotspot files', async () => {
    const server = makeServer()
    const response = await server.handleMessage(
      req('tools/call', {
        name: 'check_hotspot',
        arguments: { files: ['src/db/migrations/001.sql'] },
      }),
    )
    const result = response?.result as { content: Array<{ text: string }> }
    const data = JSON.parse(result.content[0].text)
    expect(data.touchesHotspot).toBe(true)
    expect(data.matches).toHaveLength(1)
    expect(data.matches[0].hotspot.name).toBe('db-migrations')
  })

  it('returns false for unrelated files', async () => {
    const server = makeServer()
    const response = await server.handleMessage(
      req('tools/call', {
        name: 'check_hotspot',
        arguments: { files: ['src/release/branch.ts'] },
      }),
    )
    const result = response?.result as { content: Array<{ text: string }> }
    const data = JSON.parse(result.content[0].text)
    expect(data.touchesHotspot).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// acquire_lease / release_lease tools
// ---------------------------------------------------------------------------

describe('acquire_lease / release_lease tools', () => {
  it('grants a lease for hotspot files', async () => {
    const server = makeServer()
    const response = await server.handleMessage(
      req('tools/call', {
        name: 'acquire_lease',
        arguments: { holderId: 'agent-1', files: ['src/db/migrations/002.sql'] },
      }),
    )
    const result = response?.result as { content: Array<{ text: string }> }
    const data = JSON.parse(result.content[0].text)
    expect(data.status).toBe('granted')
    expect(data.lease.holderId).toBe('agent-1')
  })

  it('blocks a second lease while the first is held', async () => {
    const services = makeServices()
    const server = makeServer(services)

    await server.handleMessage(
      req('tools/call', {
        name: 'acquire_lease',
        arguments: { holderId: 'agent-1', files: ['src/db/migrations/002.sql'] },
      }),
    )

    const response = await server.handleMessage(
      req('tools/call', {
        name: 'acquire_lease',
        arguments: { holderId: 'agent-2', files: ['src/db/migrations/003.sql'] },
      }),
    )
    const result = response?.result as { content: Array<{ text: string }> }
    const data = JSON.parse(result.content[0].text)
    expect(data.status).toBe('blocked')
    expect(data.blockedBy.holderId).toBe('agent-1')
  })

  it('releases a lease and allows the next acquire', async () => {
    const services = makeServices()
    const server = makeServer(services)

    const acqResponse = await server.handleMessage(
      req('tools/call', {
        name: 'acquire_lease',
        arguments: { holderId: 'agent-1', files: ['src/db/migrations/002.sql'] },
      }),
    )
    const acqResult = acqResponse?.result as { content: Array<{ text: string }> }
    const leaseId = JSON.parse(acqResult.content[0].text).lease.id

    const relResponse = await server.handleMessage(
      req('tools/call', { name: 'release_lease', arguments: { leaseId } }),
    )
    const relData = JSON.parse((relResponse?.result as { content: Array<{ text: string }> }).content[0].text)
    expect(relData.released).toBe(true)

    const acq2Response = await server.handleMessage(
      req('tools/call', {
        name: 'acquire_lease',
        arguments: { holderId: 'agent-2', files: ['src/db/migrations/003.sql'] },
      }),
    )
    const acq2Data = JSON.parse((acq2Response?.result as { content: Array<{ text: string }> }).content[0].text)
    expect(acq2Data.status).toBe('granted')
  })

  it('release_leases_by_holder releases all holder leases', async () => {
    const services = makeServices()
    const server = makeServer(services)

    await server.handleMessage(
      req('tools/call', {
        name: 'acquire_lease',
        arguments: { holderId: 'agent-1', files: ['src/db/migrations/002.sql'] },
      }),
    )

    const response = await server.handleMessage(
      req('tools/call', {
        name: 'release_leases_by_holder',
        arguments: { holderId: 'agent-1' },
      }),
    )
    const data = JSON.parse((response?.result as { content: Array<{ text: string }> }).content[0].text)
    expect(data.released).toBe(1)
    expect(data.holderId).toBe('agent-1')
  })

  it('list_active_leases returns current leases', async () => {
    const services = makeServices()
    const server = makeServer(services)

    await server.handleMessage(
      req('tools/call', {
        name: 'acquire_lease',
        arguments: { holderId: 'agent-1', files: ['src/db/migrations/002.sql'] },
      }),
    )

    const response = await server.handleMessage(
      req('tools/call', { name: 'list_active_leases', arguments: {} }),
    )
    const data = JSON.parse((response?.result as { content: Array<{ text: string }> }).content[0].text)
    expect(data.count).toBe(1)
    expect(data.leases[0].holderId).toBe('agent-1')
  })

  it('returns error when holderId missing on acquire', async () => {
    const server = makeServer()
    const response = await server.handleMessage(
      req('tools/call', {
        name: 'acquire_lease',
        arguments: { files: ['src/db/migrations/001.sql'] },
      }),
    )
    const result = response?.result as { isError?: boolean }
    expect(result.isError).toBe(true)
  })

  it('returns error when leaseId missing on release', async () => {
    const server = makeServer()
    const response = await server.handleMessage(
      req('tools/call', { name: 'release_lease', arguments: {} }),
    )
    const result = response?.result as { isError?: boolean }
    expect(result.isError).toBe(true)
  })
})
