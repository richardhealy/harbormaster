import { getPool } from '../db'
import { loadConfig } from '../config'
import { ImpactEstimator } from '../impact'
import { Scheduler, DEFAULT_SCHEDULER_CONFIG } from '../scheduler'
import type { DispatchPlan, SchedulerTicket } from '../scheduler'
import { createHotspotLeaseManager, HotspotLeaseManager } from '../hotspots'
import type { Hotspot, HotspotCheckResult, Lease, LeaseRequest, LeaseResult } from '../hotspots'
import { createGatePipeline } from '../gates'
import type { GatePipelineResult } from '../gates'
import { createProvenanceRecorder } from '../provenance'
import type { PersistedAuditEvent, ProvenancePool, ProvenanceQuery } from '../provenance'
import { createReleaseManager } from '../releases'
import type { ReleaseLinearClient, ReleaseManifest, ReleaseRecord, ReleasesPool } from '../releases'
import { LinearClient } from '../integrations/linear'
import {
  acquireLeaseSchema,
  buildReleaseManifestSchema,
  checkHotspotSchema,
  createReleaseSchema,
  generateReleaseNotesSchema,
  listReleasesSchema,
  planScheduleSchema,
  queryProvenanceSchema,
  recordProvenanceSchema,
  registerHotspotSchema,
  releaseLeaseByHolderSchema,
  releaseLeaseSchema,
  runGateSchema,
} from './schemas'

/**
 * The agent-facing command surface: one function per operation an agent
 * needs to drive the harbormaster loop (schedule, hotspot leases, gates,
 * provenance, releases). Both the CLI (`./cli`) and the MCP server
 * (`./mcp`) are thin adapters over these functions, so the two surfaces can
 * never drift from each other.
 *
 * Commands that need persistent state accept an optional dependency
 * (`pool`, `linearClient`, `manager`) for testability; when omitted they
 * fall back to process-wide singletons built from `loadConfig()`.
 */

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

/** Estimates each ticket's impact surface and runs the scheduler over it, returning the wave-ordered dispatch plan. */
export function planSchedule(input: unknown): DispatchPlan {
  const { tickets, mergeThreshold, sequenceThreshold } = planScheduleSchema.parse(input)

  const estimator = new ImpactEstimator()
  const surfaces = new Map(
    tickets.map(t => [
      t.ticketId,
      estimator.estimate({
        ticketId: t.ticketId,
        title: t.title,
        description: t.description,
        labels: t.labels,
        expectedFiles: t.expectedFiles,
      }),
    ]),
  )

  const schedulerTickets: SchedulerTicket[] = tickets.map(t => ({
    ticketId: t.ticketId,
    priority: t.priority,
  }))

  const scheduler = new Scheduler({
    mergeThreshold: mergeThreshold ?? DEFAULT_SCHEDULER_CONFIG.mergeThreshold,
    sequenceThreshold: sequenceThreshold ?? DEFAULT_SCHEDULER_CONFIG.sequenceThreshold,
  })

  return scheduler.plan(schedulerTickets, surfaces)
}

// ---------------------------------------------------------------------------
// Hotspot leases — shared in-process manager so leases persist for the
// lifetime of the harbormaster process (e.g. across MCP tool calls within
// one server session). Each CLI invocation is a fresh process, so leases
// taken via the CLI do not persist between separate `harbormaster` runs.
// ---------------------------------------------------------------------------

let sharedHotspotManager: HotspotLeaseManager | undefined

/** Returns the process-wide {@link HotspotLeaseManager}, creating it on first call. */
export function getHotspotManager(): HotspotLeaseManager {
  if (!sharedHotspotManager) sharedHotspotManager = createHotspotLeaseManager()
  return sharedHotspotManager
}

/** Test-only: replace the shared manager so tests don't leak state between cases. */
export function resetHotspotManager(manager?: HotspotLeaseManager): HotspotLeaseManager {
  sharedHotspotManager = manager ?? createHotspotLeaseManager()
  return sharedHotspotManager
}

/** Checks whether a set of files touches a registered hotspot, without acquiring a lease. */
export function checkHotspot(input: unknown, manager = getHotspotManager()): HotspotCheckResult {
  const { files } = checkHotspotSchema.parse(input)
  return manager.check(files)
}

/** Declares (or replaces) a hotspot — a path pattern that requires an advisory lease before work begins. */
export function registerHotspot(
  input: unknown,
  manager = getHotspotManager(),
): { registered: true; hotspot: Hotspot } {
  const hotspot = registerHotspotSchema.parse(input)
  manager.register(hotspot)
  return { registered: true, hotspot }
}

/** Attempts to acquire an advisory lease for the hotspot matched by the request's files. */
export function acquireLease(input: unknown, manager = getHotspotManager()): LeaseResult {
  const request: LeaseRequest = acquireLeaseSchema.parse(input)
  return manager.acquire(request)
}

/** Releases a single lease by id. */
export function releaseLease(input: unknown, manager = getHotspotManager()): { released: boolean } {
  const { leaseId } = releaseLeaseSchema.parse(input)
  return { released: manager.release(leaseId) }
}

/** Releases every lease held by a given holder (e.g. on dispatch completion or failure). */
export function releaseLeaseByHolder(
  input: unknown,
  manager = getHotspotManager(),
): { count: number } {
  const { holderId } = releaseLeaseByHolderSchema.parse(input)
  return { count: manager.releaseByHolder(holderId) }
}

/** Lists all currently active (non-expired) leases. */
export function listActiveLeases(manager = getHotspotManager()): Lease[] {
  return manager.listActive()
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

/**
 * Runs the scope/CI/QA/HITL gate pipeline for a change. The agent reports
 * the CI status (and optional QA/HITL results) it already observed rather
 * than the pipeline calling back out to live infrastructure — this keeps
 * the command side-effect-free and easy to test from a CLI/MCP call.
 */
export async function runGatePipeline(input: unknown): Promise<GatePipelineResult> {
  const parsed = runGateSchema.parse(input)

  const pipeline = createGatePipeline({
    checkCI: async () => parsed.ciStatus,
    runQA: parsed.qaResult ? async () => parsed.qaResult! : undefined,
    approve: parsed.approved !== undefined ? async () => parsed.approved! : undefined,
  })

  return pipeline.run({
    dispatchId: parsed.dispatchId,
    ticketId: parsed.ticketId,
    branch: parsed.branch,
    domains: parsed.domains,
    expectedFiles: parsed.expectedFiles,
    actualFiles: parsed.actualFiles,
    prNumber: parsed.prNumber,
  })
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

function resolveProvenancePool(pool?: ProvenancePool): ProvenancePool {
  return pool ?? getPool(loadConfig().DATABASE_URL)
}

/** Records a single audit event. */
export async function recordProvenance(
  input: unknown,
  pool?: ProvenancePool,
): Promise<{ id: string }> {
  const event = recordProvenanceSchema.parse(input)
  const recorder = createProvenanceRecorder(resolveProvenancePool(pool))
  const id = await recorder.record(event)
  return { id }
}

/** Queries the audit log, filtered by ticket, agent, event type, and/or time range. */
export async function queryProvenance(
  input: unknown,
  pool?: ProvenancePool,
): Promise<PersistedAuditEvent[]> {
  const parsed = queryProvenanceSchema.parse(input)
  const query: ProvenanceQuery = {
    ticketId: parsed.ticketId,
    agentId: parsed.agentId,
    eventType: parsed.eventType,
    since: parsed.since ? new Date(parsed.since) : undefined,
    limit: parsed.limit,
  }
  const recorder = createProvenanceRecorder(resolveProvenancePool(pool))
  return recorder.query(query)
}

// ---------------------------------------------------------------------------
// Releases
// ---------------------------------------------------------------------------

function resolveReleasesPool(pool?: ReleasesPool): ReleasesPool {
  return pool ?? getPool(loadConfig().DATABASE_URL)
}

/** Creates a new release row in `'planning'` status. */
export async function createRelease(input: unknown, pool?: ReleasesPool): Promise<ReleaseRecord> {
  const parsed = createReleaseSchema.parse(input)
  const manager = createReleaseManager(resolveReleasesPool(pool))
  return manager.create(parsed.version, {
    branch: parsed.branch,
    linearCycleId: parsed.linearCycleId,
    freezeAt: parsed.freezeAt ? new Date(parsed.freezeAt) : undefined,
  })
}

/** Lists releases, optionally filtered to a single status. */
export async function listReleases(input: unknown, pool?: ReleasesPool): Promise<ReleaseRecord[]> {
  const { status } = listReleasesSchema.parse(input)
  const manager = createReleaseManager(resolveReleasesPool(pool))
  return manager.listReleases(status)
}

/**
 * Builds and persists a release manifest from the team's current Linear
 * tickets. Falls back to a {@link LinearClient} built from `LINEAR_API_KEY`
 * when no `linearClient` is injected — throws if that env var is unset.
 */
export async function buildReleaseManifest(
  input: unknown,
  deps: { pool?: ReleasesPool; linearClient?: ReleaseLinearClient } = {},
): Promise<ReleaseManifest> {
  const parsed = buildReleaseManifestSchema.parse(input)
  const manager = createReleaseManager(resolveReleasesPool(deps.pool))
  const linearClient = deps.linearClient ?? defaultLinearClient()
  return manager.buildManifest(parsed.releaseId, linearClient, parsed.teamId, parsed.labelFilter)
}

function defaultLinearClient(): ReleaseLinearClient {
  const apiKey = loadConfig().LINEAR_API_KEY
  if (!apiKey) {
    throw new Error('LINEAR_API_KEY is not configured — cannot build a release manifest from Linear')
  }
  return new LinearClient(apiKey)
}

/** Pure: renders release notes markdown from an already-built manifest. */
export function generateReleaseNotes(input: unknown): string {
  const { manifest } = generateReleaseNotesSchema.parse(input)
  // generateNotes() never touches the pool, so an unused stub satisfies the constructor.
  const manager = createReleaseManager({ query: () => Promise.reject(new Error('unused')) } as ReleasesPool)
  return manager.generateNotes(manifest)
}
