import { ImpactEstimator } from '../../impact'
import { Scheduler } from '../../scheduler'
import { createHotspotLeaseManager } from '../../hotspots'
import { ProvenanceRecorder } from '../../provenance'
import type { Hotspot } from '../../hotspots'
import type { ProvenancePool } from '../../provenance'
import { DEFAULT_SCHEDULER_CONFIG } from '../../scheduler'
import type { SchedulerConfig } from '../../scheduler'
import type { CliCommand, CliResult } from './types'

export interface RunnerDeps {
  /** Pre-registered hotspots (from config or env) */
  hotspots?: Hotspot[]
  /** Database pool for provenance queries */
  provenance?: ProvenancePool
  /** Scheduler tuning overrides (merged with defaults) */
  schedulerConfig?: Partial<SchedulerConfig>
}

const USAGE = `harbormaster <command> [options]

Commands:
  schedule --tickets <t1,t2,...>          Schedule a batch of tickets
  impact <ticket-id> [--files f1,f2]      Estimate impact surface for a ticket
  lease acquire <dispatch-id> <files...>  Acquire an advisory hotspot lease
  lease release <lease-id>               Release a hotspot lease
  trail <ticket-id> [--limit N]          Get provenance trail for a ticket
  status                                 Show service status
  help                                   Show this help`

/** Execute a parsed CLI command and return a structured result. */
export async function runCommand(cmd: CliCommand, deps: RunnerDeps = {}): Promise<CliResult> {
  try {
    switch (cmd.name) {
      case 'schedule': {
        const schedulerConfig: SchedulerConfig = { ...DEFAULT_SCHEDULER_CONFIG, ...deps.schedulerConfig }
        const scheduler = new Scheduler(schedulerConfig)
        const estimator = new ImpactEstimator()
        const surfaces = new Map(
          cmd.tickets.map(id => [id, estimator.estimate({ ticketId: id, title: id })]),
        )
        const plan = scheduler.plan(cmd.tickets.map(ticketId => ({ ticketId })), surfaces)
        return { ok: true, data: plan }
      }

      case 'impact': {
        const estimator = new ImpactEstimator()
        const surface = estimator.estimate({
          ticketId: cmd.ticketId,
          title: cmd.title ?? cmd.ticketId,
          description: cmd.description,
          labels: cmd.labels,
          expectedFiles: cmd.files,
        })
        return { ok: true, data: surface }
      }

      case 'lease-acquire': {
        const manager = createHotspotLeaseManager(deps.hotspots ?? [])
        const result = manager.acquire({ holderId: cmd.dispatchId, files: cmd.files, ttlMs: cmd.ttlMs })
        return { ok: true, data: result }
      }

      case 'lease-release': {
        const manager = createHotspotLeaseManager(deps.hotspots ?? [])
        const released = manager.release(cmd.leaseId)
        return { ok: true, data: { released } }
      }

      case 'trail': {
        if (!deps.provenance) {
          return { ok: false, error: 'trail requires DATABASE_URL — no provenance pool configured' }
        }
        const recorder = new ProvenanceRecorder(deps.provenance)
        const events = await recorder.getTrail(cmd.ticketId)
        return { ok: true, data: cmd.limit != null ? events.slice(0, cmd.limit) : events }
      }

      case 'status':
        return { ok: true, data: { name: 'harbormaster', version: '0.1.0', status: 'operational' } }

      case 'help':
        return { ok: true, data: { usage: USAGE } }
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
