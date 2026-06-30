import type { MCPToolDefinition, MCPToolResult } from './types'
import type { ImpactEstimator } from '../../impact'
import type { Scheduler, SchedulerTicket } from '../../scheduler'
import type { ImpactEstimateInput } from '../../impact/types'
import type { HotspotLeaseManager } from '../../hotspots'

/** Services injected into the MCP tools — keeps them testable without live infrastructure */
export interface MCPServices {
  impactEstimator: ImpactEstimator
  scheduler: Scheduler
  leaseManager: HotspotLeaseManager
}

/** Format a value as a JSON text block for MCP content */
function json(value: unknown): MCPToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function err(message: string): MCPToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

/** Return all registered MCP tool definitions for the harbormaster agent interface */
export function buildTools(services: MCPServices): MCPToolDefinition[] {
  const { impactEstimator, scheduler, leaseManager } = services

  return [
    // -------------------------------------------------------------------------
    // schedule_tickets
    // -------------------------------------------------------------------------
    {
      tool: {
        name: 'schedule_tickets',
        description:
          'Estimate the impact surface for each ticket and produce a conflict-aware dispatch plan. ' +
          'Groups within the same wave are safe to run in parallel; later waves must wait. ' +
          'Tickets with high file overlap are merged into a single agent job.',
        inputSchema: {
          type: 'object',
          properties: {
            tickets: {
              type: 'array',
              description: 'Tickets to schedule',
              items: {
                type: 'object',
                properties: {
                  ticketId: { type: 'string', description: 'Ticket identifier (e.g. ENG-42)' },
                  title: { type: 'string', description: 'Ticket title' },
                  description: { type: 'string', description: 'Optional ticket body' },
                  labels: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Labels / tags on the ticket',
                  },
                  expectedFiles: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Files the agent expects to modify (highest confidence)',
                  },
                  priority: {
                    type: 'number',
                    description: 'Scheduling priority; lower value = higher priority (default 0)',
                  },
                },
                required: ['ticketId', 'title'],
              },
            },
          },
          required: ['tickets'],
        },
      },
      async handler(args) {
        const rawTickets = args.tickets as Array<{
          ticketId: string
          title: string
          description?: string
          labels?: string[]
          expectedFiles?: string[]
          priority?: number
        }>

        if (!Array.isArray(rawTickets) || rawTickets.length === 0) {
          return err('tickets must be a non-empty array')
        }

        const surfaces = new Map(
          rawTickets.map((t) => {
            const input: ImpactEstimateInput = {
              ticketId: t.ticketId,
              title: t.title,
              description: t.description,
              labels: t.labels,
              expectedFiles: t.expectedFiles,
            }
            return [t.ticketId, impactEstimator.estimate(input)]
          }),
        )

        const schedulerTickets: SchedulerTicket[] = rawTickets.map((t) => ({
          ticketId: t.ticketId,
          priority: t.priority,
        }))

        const plan = scheduler.plan(schedulerTickets, surfaces)

        return json({
          plan: {
            waves: plan.waves.map((wave) =>
              wave.map((g) => ({
                id: g.id,
                tickets: g.tickets,
                decision: g.decision,
                reason: g.reason,
                overlapScore: g.overlapScore,
              })),
            ),
            mergeCount: plan.mergeCount,
            ticketCount: plan.ticketCount,
          },
          surfaces: [...surfaces.values()].map((s) => ({
            ticketId: s.ticketId,
            files: s.files,
            directories: s.directories,
            domains: s.domains,
            confidence: s.confidence,
          })),
        })
      },
    },

    // -------------------------------------------------------------------------
    // check_hotspot
    // -------------------------------------------------------------------------
    {
      tool: {
        name: 'check_hotspot',
        description:
          'Check whether a list of files touches any registered hotspot. ' +
          'Returns the matched hotspots and their patterns. Does not acquire a lease.',
        inputSchema: {
          type: 'object',
          properties: {
            files: {
              type: 'array',
              items: { type: 'string' },
              description: 'File paths the dispatch intends to modify',
            },
          },
          required: ['files'],
        },
      },
      async handler(args) {
        const files = args.files as string[]
        if (!Array.isArray(files)) return err('files must be an array of strings')

        const result = leaseManager.check(files)
        return json(result)
      },
    },

    // -------------------------------------------------------------------------
    // acquire_lease
    // -------------------------------------------------------------------------
    {
      tool: {
        name: 'acquire_lease',
        description:
          'Acquire an advisory lease for a dispatch that touches a registered hotspot. ' +
          'Returns status "granted", "blocked" (another holder active), or "not-required" ' +
          '(files do not touch any hotspot).',
        inputSchema: {
          type: 'object',
          properties: {
            holderId: {
              type: 'string',
              description: 'Unique ID of the dispatch or agent requesting the lease',
            },
            files: {
              type: 'array',
              items: { type: 'string' },
              description: 'Files the dispatch intends to modify',
            },
            ttlMs: {
              type: 'number',
              description: 'Lease TTL in milliseconds; omit for no automatic expiry',
            },
          },
          required: ['holderId', 'files'],
        },
      },
      async handler(args) {
        const holderId = args.holderId as string
        const files = args.files as string[]
        const ttlMs = args.ttlMs as number | undefined

        if (!holderId || typeof holderId !== 'string') return err('holderId must be a string')
        if (!Array.isArray(files)) return err('files must be an array of strings')

        const result = leaseManager.acquire({ holderId, files, ttlMs })
        return json(result)
      },
    },

    // -------------------------------------------------------------------------
    // release_lease
    // -------------------------------------------------------------------------
    {
      tool: {
        name: 'release_lease',
        description: 'Release a hotspot lease by its lease ID.',
        inputSchema: {
          type: 'object',
          properties: {
            leaseId: { type: 'string', description: 'The lease ID returned by acquire_lease' },
          },
          required: ['leaseId'],
        },
      },
      async handler(args) {
        const leaseId = args.leaseId as string
        if (!leaseId || typeof leaseId !== 'string') return err('leaseId must be a string')

        const released = leaseManager.release(leaseId)
        return json({ released, leaseId })
      },
    },

    // -------------------------------------------------------------------------
    // release_leases_by_holder
    // -------------------------------------------------------------------------
    {
      tool: {
        name: 'release_leases_by_holder',
        description: 'Release all active hotspot leases held by a given dispatch or agent ID.',
        inputSchema: {
          type: 'object',
          properties: {
            holderId: {
              type: 'string',
              description: 'The holder ID whose leases should be released',
            },
          },
          required: ['holderId'],
        },
      },
      async handler(args) {
        const holderId = args.holderId as string
        if (!holderId || typeof holderId !== 'string') return err('holderId must be a string')

        const count = leaseManager.releaseByHolder(holderId)
        return json({ released: count, holderId })
      },
    },

    // -------------------------------------------------------------------------
    // list_active_leases
    // -------------------------------------------------------------------------
    {
      tool: {
        name: 'list_active_leases',
        description: 'List all currently active (non-expired) hotspot leases.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      async handler() {
        const leases = leaseManager.listActive()
        return json({ leases, count: leases.length })
      },
    },
  ]
}
