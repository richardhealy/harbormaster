import type { ParsedArgs, CLIResult } from './types'
import type { ImpactEstimator } from '../../impact'
import type { Scheduler, SchedulerTicket } from '../../scheduler'
import type { ImpactEstimateInput } from '../../impact/types'
import type { HotspotLeaseManager } from '../../hotspots'

/** Services injected into CLI commands */
export interface CLIServices {
  impactEstimator: ImpactEstimator
  scheduler: Scheduler
  leaseManager: HotspotLeaseManager
}

function ok(output: string): CLIResult {
  return { exitCode: 0, output }
}

function fail(output: string): CLIResult {
  return { exitCode: 1, output }
}

function jsonOut(value: unknown): CLIResult {
  return ok(JSON.stringify(value, null, 2))
}

// ---------------------------------------------------------------------------
// schedule command
// ---------------------------------------------------------------------------

/**
 * hm schedule <ticketId> [<ticketId>...]
 *   [--files path/a path/b ...]    files for the last named ticket
 *   [--labels lbl1 lbl2 ...]       labels for the last named ticket
 *   [--title "..."]                title for the last named ticket (default: ticketId)
 *   [--priority N]
 *
 * For multi-ticket scheduling each ticket gets its own --files etc. block;
 * in practice agents call the MCP tool for richer input. The CLI is optimised
 * for quick single-ticket queries and simple multi-ticket checks.
 */
export function handleSchedule(args: ParsedArgs, services: CLIServices): CLIResult {
  const { positional, flags, subcommand } = args

  // The ticket IDs can be positional args or the subcommand itself
  const ids = subcommand ? [subcommand, ...positional] : positional
  if (ids.length === 0) {
    return fail('Usage: hm schedule <ticketId> [<ticketId>...] [--files ...] [--title "..."] [--labels ...] [--priority N]')
  }

  const files = (flags['files'] as string[] | undefined) ?? []
  const labels = (flags['labels'] as string[] | undefined) ?? []
  const title = (flags['title'] as string | undefined) ?? ids[0]
  const priority = typeof flags['priority'] === 'number' ? flags['priority'] : 0

  const { impactEstimator, scheduler } = services
  const surfaces = new Map(
    ids.map((id, idx) => {
      const input: ImpactEstimateInput = {
        ticketId: id,
        title: idx === 0 ? title : id,
        labels: idx === 0 ? labels : [],
        expectedFiles: idx === 0 ? files : [],
      }
      return [id, impactEstimator.estimate(input)]
    }),
  )

  const tickets: SchedulerTicket[] = ids.map((id, idx) => ({
    ticketId: id,
    priority: idx === 0 ? priority : idx,
  }))

  const plan = scheduler.plan(tickets, surfaces)

  return jsonOut({
    waves: plan.waves.map((wave) =>
      wave.map((g) => ({
        id: g.id,
        tickets: g.tickets,
        decision: g.decision,
        reason: g.reason,
        overlapScore: g.overlapScore,
      })),
    ),
    surfaces: [...surfaces.values()].map((s) => ({
      ticketId: s.ticketId,
      files: s.files,
      domains: s.domains,
      confidence: s.confidence,
    })),
  })
}

// ---------------------------------------------------------------------------
// hotspot command
// ---------------------------------------------------------------------------

export function handleHotspot(args: ParsedArgs, services: CLIServices): CLIResult {
  const { subcommand, flags } = args
  const { leaseManager } = services

  if (subcommand === 'check') {
    const files = (flags['files'] as string[] | undefined) ?? []
    if (files.length === 0) {
      return fail('Usage: hm hotspot check --files <path> [<path>...]')
    }
    return jsonOut(leaseManager.check(files))
  }

  return fail('Usage: hm hotspot check --files <path> [<path>...]')
}

// ---------------------------------------------------------------------------
// lease command
// ---------------------------------------------------------------------------

export function handleLease(args: ParsedArgs, services: CLIServices): CLIResult {
  const { subcommand, flags, positional } = args
  const { leaseManager } = services

  if (subcommand === 'acquire') {
    const holderId = flags['holder'] as string | undefined
    const files = (flags['files'] as string[] | undefined) ?? []
    const ttlMs = typeof flags['ttl'] === 'number' ? flags['ttl'] : undefined

    if (!holderId) return fail('Usage: hm lease acquire --holder <id> --files <path>...')
    if (files.length === 0) return fail('Usage: hm lease acquire --holder <id> --files <path>...')

    return jsonOut(leaseManager.acquire({ holderId, files, ttlMs }))
  }

  if (subcommand === 'release') {
    const leaseId = (flags['id'] as string | undefined) ?? positional[0]
    if (!leaseId) return fail('Usage: hm lease release --id <leaseId>')
    const released = leaseManager.release(leaseId)
    return jsonOut({ released, leaseId })
  }

  if (subcommand === 'release-holder') {
    const holderId = (flags['holder'] as string | undefined) ?? positional[0]
    if (!holderId) return fail('Usage: hm lease release-holder --holder <id>')
    const count = leaseManager.releaseByHolder(holderId)
    return jsonOut({ released: count, holderId })
  }

  if (subcommand === 'list') {
    const leases = leaseManager.listActive()
    return jsonOut({ leases, count: leases.length })
  }

  return fail('Usage: hm lease <acquire|release|release-holder|list>')
}

// ---------------------------------------------------------------------------
// help command
// ---------------------------------------------------------------------------

export function handleHelp(): CLIResult {
  const text = `
harbormaster CLI — fleet coordination for AI coding agents

Commands:
  hm schedule <ticketId> [<ticketId>...]
      Estimate impact and produce a dispatch plan.
      Options: --files <path>...  --labels <lbl>...  --title <str>  --priority <n>

  hm hotspot check --files <path>...
      Check whether files touch a registered hotspot (no lease acquired).

  hm lease acquire --holder <id> --files <path>... [--ttl <ms>]
      Acquire an advisory lease on a matched hotspot.

  hm lease release --id <leaseId>
      Release a lease by ID.

  hm lease release-holder --holder <id>
      Release all leases held by a given dispatch or agent.

  hm lease list
      List all active leases.

  hm help
      Show this message.
`.trimStart()
  return ok(text)
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

export function dispatch(args: ParsedArgs, services: CLIServices): CLIResult {
  switch (args.command) {
    case 'schedule':
      return handleSchedule(args, services)
    case 'hotspot':
      return handleHotspot(args, services)
    case 'lease':
      return handleLease(args, services)
    case 'help':
    case '--help':
    case '-h':
    case '':
      return handleHelp()
    default:
      return fail(`Unknown command: ${args.command}\nRun 'hm help' for usage.`)
  }
}
