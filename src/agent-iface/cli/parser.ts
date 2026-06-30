import type { CliCommand } from './types'

/**
 * Parse raw argv (the slice after `node script.js`) into a typed CliCommand.
 * Throws a descriptive Error on invalid input.
 */
export function parseArgs(argv: string[]): CliCommand {
  const [subcommand, ...rest] = argv

  switch (subcommand) {
    case 'schedule':
      return parseSchedule(rest)
    case 'impact':
      return parseImpact(rest)
    case 'lease':
      return parseLease(rest)
    case 'trail':
      return parseTrail(rest)
    case 'status':
      return { name: 'status' }
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      return { name: 'help' }
    default:
      throw new Error(`Unknown command: ${subcommand}. Run 'harbormaster help' for usage.`)
  }
}

function parseSchedule(args: string[]): Extract<CliCommand, { name: 'schedule' }> {
  const flags = parseFlags(args)
  const raw = flags['tickets'] ?? flags['t']
  if (!raw) throw new Error("schedule requires --tickets <t1,t2,...>")

  const tickets = toArray(raw).flatMap(v => v.split(',')).filter(Boolean)
  if (tickets.length === 0) throw new Error("schedule --tickets must be non-empty")

  return {
    name: 'schedule',
    tickets,
    mergeThreshold: numFlag(flags, 'merge-threshold'),
    sequenceThreshold: numFlag(flags, 'sequence-threshold'),
  }
}

function parseImpact(args: string[]): Extract<CliCommand, { name: 'impact' }> {
  const [ticketId, ...rest] = args
  if (!ticketId || ticketId.startsWith('-')) throw new Error("impact requires <ticket-id>")
  const flags = parseFlags(rest)
  return {
    name: 'impact',
    ticketId,
    files: splitFlag(flags, 'files') ?? splitFlag(flags, 'f'),
    labels: splitFlag(flags, 'labels') ?? splitFlag(flags, 'l'),
    title: strFlag(flags, 'title'),
    description: strFlag(flags, 'description'),
  }
}

function parseLease(
  args: string[],
): Extract<CliCommand, { name: 'lease-acquire' }> | Extract<CliCommand, { name: 'lease-release' }> {
  const [action, ...rest] = args
  if (action === 'acquire') {
    const [dispatchId, ...tail] = rest
    if (!dispatchId) throw new Error("lease acquire requires <dispatch-id>")
    // Collect non-flag positionals and pass all to parseFlags for flag values
    const fileArgs: string[] = []
    let i = 0
    while (i < tail.length) {
      if (tail[i].startsWith('--')) {
        i++ // skip flag name; parseFlags will handle the value
        if (i < tail.length && !tail[i].startsWith('--')) i++ // skip flag value
      } else {
        fileArgs.push(tail[i])
        i++
      }
    }
    const flags = parseFlags(tail)
    if (fileArgs.length === 0) throw new Error("lease acquire requires at least one <file>")
    return { name: 'lease-acquire', dispatchId, files: fileArgs, ttlMs: numFlag(flags, 'ttl') }
  }
  if (action === 'release') {
    const [leaseId] = rest
    if (!leaseId) throw new Error("lease release requires <lease-id>")
    return { name: 'lease-release', leaseId }
  }
  throw new Error("lease requires 'acquire' or 'release'")
}

function parseTrail(args: string[]): Extract<CliCommand, { name: 'trail' }> {
  const [ticketId, ...rest] = args
  if (!ticketId || ticketId.startsWith('-')) throw new Error("trail requires <ticket-id>")
  const flags = parseFlags(rest)
  return { name: 'trail', ticketId, limit: numFlag(flags, 'limit') }
}

// ---------------------------------------------------------------------------
// Flag parsing helpers
// ---------------------------------------------------------------------------

function parseFlags(args: string[]): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  let i = 0
  while (i < args.length) {
    const arg = args[i]
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      if (eq !== -1) {
        set(out, arg.slice(2, eq), arg.slice(eq + 1))
      } else {
        const key = arg.slice(2)
        const next = args[i + 1]
        if (next !== undefined && !next.startsWith('--')) {
          set(out, key, next)
          i++
        } else {
          set(out, key, 'true')
        }
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      const key = arg[1]
      const next = args[i + 1]
      if (next !== undefined && !next.startsWith('-')) {
        set(out, key, next)
        i++
      } else {
        set(out, key, 'true')
      }
    }
    i++
  }
  return out
}

function set(out: Record<string, string | string[]>, key: string, value: string): void {
  const existing = out[key]
  if (existing === undefined) {
    out[key] = value
  } else {
    out[key] = [...toArray(existing), value]
  }
}

function toArray(v: string | string[]): string[] {
  return Array.isArray(v) ? v : [v]
}

function strFlag(flags: Record<string, string | string[]>, key: string): string | undefined {
  const v = flags[key]
  return v !== undefined ? toArray(v).join(' ') : undefined
}

function numFlag(flags: Record<string, string | string[]>, key: string): number | undefined {
  const v = flags[key]
  if (v === undefined) return undefined
  const n = Number(toArray(v)[0])
  return isNaN(n) ? undefined : n
}

function splitFlag(flags: Record<string, string | string[]>, key: string): string[] | undefined {
  const v = flags[key]
  if (v === undefined) return undefined
  return toArray(v).flatMap(s => s.split(',')).filter(Boolean)
}
