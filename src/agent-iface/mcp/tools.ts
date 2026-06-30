import { ImpactEstimator } from '../../impact'
import { Scheduler } from '../../scheduler'
import { DEFAULT_SCHEDULER_CONFIG } from '../../scheduler'
import { createHotspotLeaseManager } from '../../hotspots'
import { ProvenanceRecorder } from '../../provenance'
import type { Hotspot } from '../../hotspots'
import type { ProvenancePool } from '../../provenance'
import type { SchedulerConfig } from '../../scheduler'
import type { McpToolDefinition, McpToolResult } from './types'

export interface ToolsDeps {
  hotspots?: Hotspot[]
  provenance?: ProvenancePool
}

function ok(data: unknown): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

function fail(message: string): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true }
}

/** Build the set of MCP tool definitions with injected dependencies. */
export function createTools(deps: ToolsDeps = {}): McpToolDefinition[] {
  const leaseManager = createHotspotLeaseManager(deps.hotspots ?? [])

  return [
    // -----------------------------------------------------------------------
    // hm_schedule
    // -----------------------------------------------------------------------
    {
      schema: {
        name: 'hm_schedule',
        description:
          'Schedule a batch of tickets into a conflict-aware dispatch plan. ' +
          'Returns ordered waves: tickets in the same wave are safe to run in parallel; ' +
          'tickets in later waves must wait. Tickets with very high overlap are merged into one job.',
        inputSchema: {
          type: 'object',
          properties: {
            tickets: {
              type: 'array',
              description: 'Ticket IDs to schedule (e.g. ["ENG-1", "ENG-2"])',
              items: { type: 'string' },
            },
            mergeThreshold: {
              type: 'number',
              description: 'Jaccard overlap ≥ this value causes tickets to be merged into one job (default 0.7)',
            },
            sequenceThreshold: {
              type: 'number',
              description: 'Jaccard overlap above this value causes sequencing (default 0.2)',
            },
          },
          required: ['tickets'],
        },
      },
      handler: async (args) => {
        if (!Array.isArray(args.tickets) || args.tickets.length === 0) {
          return fail('tickets must be a non-empty array of ticket ID strings')
        }
        const ids = args.tickets as string[]
        const config: SchedulerConfig = {
          ...DEFAULT_SCHEDULER_CONFIG,
          ...(typeof args.mergeThreshold === 'number' ? { mergeThreshold: args.mergeThreshold } : {}),
          ...(typeof args.sequenceThreshold === 'number' ? { sequenceThreshold: args.sequenceThreshold } : {}),
        }
        const scheduler = new Scheduler(config)
        const estimator = new ImpactEstimator()
        const surfaces = new Map(ids.map(id => [id, estimator.estimate({ ticketId: id, title: id })]))
        const plan = scheduler.plan(ids.map(ticketId => ({ ticketId })), surfaces)
        return ok(plan)
      },
    },

    // -----------------------------------------------------------------------
    // hm_estimate_impact
    // -----------------------------------------------------------------------
    {
      schema: {
        name: 'hm_estimate_impact',
        description:
          'Estimate the impact surface of a ticket: which files, directories, and domains it ' +
          'is likely to touch. Confidence is 1.0 when explicit files are given; lower when ' +
          'derived from labels (0.6) or title/description keywords (0.3).',
        inputSchema: {
          type: 'object',
          properties: {
            ticketId: { type: 'string', description: 'Ticket identifier (e.g. ENG-42)' },
            expectedFiles: {
              type: 'array',
              description: 'Known file paths the ticket should touch (highest-confidence input)',
              items: { type: 'string' },
            },
            labels: {
              type: 'array',
              description: 'Ticket labels for domain inference (e.g. ["release", "db"])',
              items: { type: 'string' },
            },
            title: { type: 'string', description: 'Ticket title for keyword inference' },
            description: { type: 'string', description: 'Ticket description for keyword inference' },
          },
          required: ['ticketId'],
        },
      },
      handler: async (args) => {
        if (typeof args.ticketId !== 'string' || !args.ticketId) {
          return fail('ticketId is required and must be a string')
        }
        const estimator = new ImpactEstimator()
        const surface = estimator.estimate({
          ticketId: args.ticketId,
          title: typeof args.title === 'string' ? args.title : args.ticketId,
          description: typeof args.description === 'string' ? args.description : undefined,
          labels: Array.isArray(args.labels) ? (args.labels as string[]) : undefined,
          expectedFiles: Array.isArray(args.expectedFiles) ? (args.expectedFiles as string[]) : undefined,
        })
        return ok(surface)
      },
    },

    // -----------------------------------------------------------------------
    // hm_check_hotspot
    // -----------------------------------------------------------------------
    {
      schema: {
        name: 'hm_check_hotspot',
        description:
          'Check whether a list of files touches a declared hotspot, without acquiring a lease. ' +
          'Use this before starting work to decide whether to call hm_acquire_lease.',
        inputSchema: {
          type: 'object',
          properties: {
            files: {
              type: 'array',
              description: 'File paths the agent intends to modify',
              items: { type: 'string' },
            },
          },
          required: ['files'],
        },
      },
      handler: async (args) => {
        if (!Array.isArray(args.files)) return fail('files must be an array of path strings')
        return ok(leaseManager.check(args.files as string[]))
      },
    },

    // -----------------------------------------------------------------------
    // hm_acquire_lease
    // -----------------------------------------------------------------------
    {
      schema: {
        name: 'hm_acquire_lease',
        description:
          'Acquire an advisory lease on a hotspot path before modifying it. ' +
          'Returns status "granted" (you have the lease), "blocked" (another agent holds it), ' +
          'or "not-required" (no declared hotspot matches your files — proceed without a lease).',
        inputSchema: {
          type: 'object',
          properties: {
            dispatchId: { type: 'string', description: 'Unique ID of this dispatch or agent run' },
            files: {
              type: 'array',
              description: 'File paths the agent intends to modify',
              items: { type: 'string' },
            },
            ttlMs: {
              type: 'number',
              description: 'Optional TTL in milliseconds; lease auto-expires if not released in time',
            },
          },
          required: ['dispatchId', 'files'],
        },
      },
      handler: async (args) => {
        if (typeof args.dispatchId !== 'string' || !args.dispatchId) {
          return fail('dispatchId is required')
        }
        if (!Array.isArray(args.files)) return fail('files must be an array')
        return ok(
          leaseManager.acquire({
            holderId: args.dispatchId,
            files: args.files as string[],
            ttlMs: typeof args.ttlMs === 'number' ? args.ttlMs : undefined,
          }),
        )
      },
    },

    // -----------------------------------------------------------------------
    // hm_release_lease
    // -----------------------------------------------------------------------
    {
      schema: {
        name: 'hm_release_lease',
        description:
          'Release a hotspot lease once the agent has finished modifying the hotspot files. ' +
          'Always call this on task completion or failure so other agents are not blocked.',
        inputSchema: {
          type: 'object',
          properties: {
            leaseId: { type: 'string', description: 'Lease ID returned from hm_acquire_lease' },
          },
          required: ['leaseId'],
        },
      },
      handler: async (args) => {
        if (typeof args.leaseId !== 'string') return fail('leaseId is required')
        return ok({ released: leaseManager.release(args.leaseId) })
      },
    },

    // -----------------------------------------------------------------------
    // hm_get_trail
    // -----------------------------------------------------------------------
    {
      schema: {
        name: 'hm_get_trail',
        description:
          'Retrieve the provenance trail for a ticket: all recorded audit events ' +
          '(dispatches created, gate decisions, merges, releases) in reverse-chronological order.',
        inputSchema: {
          type: 'object',
          properties: {
            ticketId: { type: 'string', description: 'Ticket ID to retrieve the trail for' },
            limit: {
              type: 'number',
              description: 'Maximum number of events to return (default 100)',
            },
          },
          required: ['ticketId'],
        },
      },
      handler: async (args) => {
        if (typeof args.ticketId !== 'string') return fail('ticketId is required')
        if (!deps.provenance) {
          return fail('provenance store not configured; set DATABASE_URL to enable trail queries')
        }
        const recorder = new ProvenanceRecorder(deps.provenance)
        const events = await recorder.getTrail(args.ticketId)
        const limited = typeof args.limit === 'number' ? events.slice(0, args.limit) : events
        return ok(limited)
      },
    },
  ]
}
