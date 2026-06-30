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

/** Input for `planSchedule`: a batch of tickets to impact-estimate and schedule into a dispatch plan. */
export const planScheduleSchema = z.object({
  tickets: z.array(ticketPlanInputSchema).min(1),
  mergeThreshold: z.number().min(0).max(1).optional(),
  sequenceThreshold: z.number().min(0).max(1).optional(),
})

/** Input for `checkHotspot`: a candidate file list to test against registered hotspots, without acquiring a lease. */
export const checkHotspotSchema = z.object({
  files: z.array(z.string()).min(1),
})

/** Input for `registerHotspot`: declares (or replaces) a named hotspot definition. */
export const registerHotspotSchema = z.object({
  name: z.string().min(1),
  patterns: z.array(z.string()).min(1),
  reason: z.string().min(1),
})

/** Input for `acquireLease`: a request to take an advisory lease over a file set on behalf of `holderId`. */
export const acquireLeaseSchema = z.object({
  holderId: z.string().min(1),
  files: z.array(z.string()).min(1),
  ttlMs: z.number().positive().optional(),
})

/** Input for `releaseLease`: release a single lease by its id. */
export const releaseLeaseSchema = z.object({
  leaseId: z.string().min(1),
})

/** Input for `releaseLeaseByHolder`: release every lease held by a given dispatch/agent id. */
export const releaseLeaseByHolderSchema = z.object({
  holderId: z.string().min(1),
})

/** Input for `listActiveLeases`: takes no parameters; present so the command still has a registrable zod shape. */
export const listActiveLeasesSchema = z.object({})

/**
 * Input for `runGatePipeline`. `ciStatus` (and the optional `qaResult`/`approved`)
 * are reported by the calling agent rather than fetched live — the gate pipeline
 * only judges the status it's handed, it never reaches out to CI/QA/HITL infra itself.
 */
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

/** Input for `recordProvenance`: one immutable audit-log event. */
export const recordProvenanceSchema = z.object({
  eventType: z.enum(AUDIT_EVENT_TYPES),
  payload: z.record(z.unknown()).default({}),
  ticketId: z.string().optional(),
  agentId: z.string().optional(),
  actor: z.string().min(1),
})

/** Input for `queryProvenance`: filters for reading back audit-log events. */
export const queryProvenanceSchema = z.object({
  ticketId: z.string().optional(),
  agentId: z.string().optional(),
  eventType: z.enum(AUDIT_EVENT_TYPES).optional(),
  since: z.string().datetime().optional(),
  limit: z.number().positive().optional(),
})

/** Input for `createRelease`: creates a new release record in the planning stage. */
export const createReleaseSchema = z.object({
  version: z.string().min(1),
  branch: z.string().min(1),
  linearCycleId: z.string().optional(),
  freezeAt: z.string().datetime().optional(),
})

/** Input for `listReleases`: optional status filter. */
export const listReleasesSchema = z.object({
  status: z.enum(['planning', 'in_progress', 'frozen', 'released', 'cancelled']).optional(),
})

/** Input for `buildReleaseManifest`: which release/team to pull tickets for from Linear, with an optional label filter. */
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

/** Input for `generateReleaseNotes`: an already-built release manifest to render as markdown. */
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
