import { z } from 'zod'
import { AUDIT_EVENT_TYPES } from '../provenance/types'

/**
 * Zod schemas for every agent-facing command. Shared by the CLI and the MCP
 * server so both surfaces validate identically and the MCP tool definitions
 * stay in sync with what `commands.ts` actually accepts.
 */

const ticketPlanInputSchema = z.object({
  ticketId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  labels: z.array(z.string()).optional(),
  expectedFiles: z.array(z.string()).optional(),
  priority: z.number().optional(),
})

export const planScheduleSchema = z.object({
  tickets: z.array(ticketPlanInputSchema).min(1),
  mergeThreshold: z.number().min(0).max(1).optional(),
  sequenceThreshold: z.number().min(0).max(1).optional(),
})

export const checkHotspotSchema = z.object({
  files: z.array(z.string()).min(1),
})

export const registerHotspotSchema = z.object({
  name: z.string().min(1),
  patterns: z.array(z.string()).min(1),
  reason: z.string().min(1),
})

export const acquireLeaseSchema = z.object({
  holderId: z.string().min(1),
  files: z.array(z.string()).min(1),
  ttlMs: z.number().positive().optional(),
})

export const releaseLeaseSchema = z.object({
  leaseId: z.string().min(1),
})

export const releaseLeaseByHolderSchema = z.object({
  holderId: z.string().min(1),
})

export const listActiveLeasesSchema = z.object({})

export const runGateSchema = z.object({
  dispatchId: z.string().min(1),
  ticketId: z.string().min(1),
  branch: z.string().min(1),
  domains: z.array(z.string()).default([]),
  expectedFiles: z.array(z.string()).default([]),
  actualFiles: z.array(z.string()).default([]),
  prNumber: z.number().optional(),
  ciStatus: z.enum(['success', 'failure', 'pending', 'unknown']),
  qaResult: z.object({ passed: z.boolean(), reason: z.string().optional() }).optional(),
  approved: z.boolean().optional(),
})

export const recordProvenanceSchema = z.object({
  eventType: z.enum(AUDIT_EVENT_TYPES),
  payload: z.record(z.unknown()).default({}),
  ticketId: z.string().optional(),
  agentId: z.string().optional(),
  actor: z.string().min(1),
})

export const queryProvenanceSchema = z.object({
  ticketId: z.string().optional(),
  agentId: z.string().optional(),
  eventType: z.enum(AUDIT_EVENT_TYPES).optional(),
  since: z.string().datetime().optional(),
  limit: z.number().positive().optional(),
})

export const createReleaseSchema = z.object({
  version: z.string().min(1),
  branch: z.string().min(1),
  linearCycleId: z.string().optional(),
  freezeAt: z.string().datetime().optional(),
})

export const listReleasesSchema = z.object({
  status: z.enum(['planning', 'in_progress', 'frozen', 'released', 'cancelled']).optional(),
})

export const buildReleaseManifestSchema = z.object({
  releaseId: z.string().min(1),
  teamId: z.string().min(1),
  labelFilter: z.array(z.string()).optional(),
})

const manifestTicketSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  description: z.string().optional(),
  status: z.string(),
  priority: z.number(),
  labels: z.array(z.string()),
  assignee: z.string().optional(),
  url: z.string().optional(),
})

export const generateReleaseNotesSchema = z.object({
  manifest: z.object({
    releaseId: z.string(),
    version: z.string(),
    generatedAt: z.string(),
    linearCycleId: z.string().optional(),
    tickets: z.array(manifestTicketSchema),
    summary: z.object({
      total: z.number(),
      byStatus: z.record(z.number()),
      byPriority: z.record(z.number()),
    }),
  }),
})
