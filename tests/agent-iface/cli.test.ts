import { describe, it, expect, beforeEach } from 'vitest'
import { parseArgs } from '../../src/agent-iface/cli/parser'
import { dispatch, handleHelp } from '../../src/agent-iface/cli/commands'
import type { CLIServices } from '../../src/agent-iface/cli/commands'
import { ImpactEstimator } from '../../src/impact'
import { Scheduler } from '../../src/scheduler'
import { createHotspotLeaseManager } from '../../src/hotspots'
import type { Hotspot } from '../../src/hotspots/types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MIGRATION_HOTSPOT: Hotspot = {
  name: 'db-migrations',
  patterns: ['src/db/migrations/'],
  reason: 'Database migrations must not run concurrently',
}

function makeServices(): CLIServices {
  const leaseManager = createHotspotLeaseManager([MIGRATION_HOTSPOT])
  return {
    impactEstimator: new ImpactEstimator(),
    scheduler: new Scheduler(),
    leaseManager,
  }
}

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  it('parses a simple command', () => {
    const result = parseArgs(['schedule', 'ENG-1'])
    expect(result.command).toBe('schedule')
    expect(result.subcommand).toBe('ENG-1')
    expect(result.positional).toHaveLength(0)
  })

  it('parses command and subcommand', () => {
    const result = parseArgs(['lease', 'acquire'])
    expect(result.command).toBe('lease')
    expect(result.subcommand).toBe('acquire')
  })

  it('parses --flag value', () => {
    const result = parseArgs(['lease', 'acquire', '--holder', 'dispatch-1'])
    expect(result.flags['holder']).toBe('dispatch-1')
  })

  it('parses --bool flag (no value)', () => {
    const result = parseArgs(['help', '--verbose'])
    expect(result.flags['verbose']).toBe(true)
  })

  it('parses --files as multi-value', () => {
    const result = parseArgs(['schedule', 'T-1', '--files', 'src/a.ts', 'src/b.ts'])
    expect(result.flags['files']).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('parses --labels as multi-value', () => {
    const result = parseArgs(['schedule', 'T-1', '--labels', 'release', 'db'])
    expect(result.flags['labels']).toEqual(['release', 'db'])
  })

  it('parses numeric flag', () => {
    const result = parseArgs(['schedule', 'T-1', '--priority', '3'])
    expect(result.flags['priority']).toBe(3)
  })

  it('handles empty input', () => {
    const result = parseArgs([])
    expect(result.command).toBe('')
    expect(result.subcommand).toBeUndefined()
    expect(result.positional).toHaveLength(0)
  })

  it('collects extra positionals', () => {
    const result = parseArgs(['schedule', 'T-1', 'T-2', 'T-3'])
    expect(result.command).toBe('schedule')
    expect(result.subcommand).toBe('T-1')
    expect(result.positional).toEqual(['T-2', 'T-3'])
  })
})

// ---------------------------------------------------------------------------
// schedule command
// ---------------------------------------------------------------------------

describe('dispatch — schedule', () => {
  let services: CLIServices

  beforeEach(() => {
    services = makeServices()
  })

  it('returns error for missing ticket id', () => {
    const args = parseArgs(['schedule'])
    const result = dispatch(args, services)
    expect(result.exitCode).toBe(1)
    expect(result.output).toMatch(/Usage/)
  })

  it('schedules a single ticket and returns a plan', () => {
    const args = parseArgs(['schedule', 'ENG-1', '--title', 'Add auth'])
    const result = dispatch(args, services)
    expect(result.exitCode).toBe(0)
    const data = JSON.parse(result.output)
    expect(data.waves).toHaveLength(1)
    expect(data.waves[0][0].tickets).toContain('ENG-1')
    expect(data.surfaces).toHaveLength(1)
    expect(data.surfaces[0].ticketId).toBe('ENG-1')
  })

  it('schedules two non-overlapping tickets in parallel', () => {
    const args = parseArgs(['schedule', 'ENG-1', 'ENG-2', '--files', 'src/release/branch.ts'])
    const result = dispatch(args, services)
    expect(result.exitCode).toBe(0)
    const data = JSON.parse(result.output)
    // Two tickets with different domains should land in one wave
    expect(data.waves).toHaveLength(1)
    expect(data.waves[0]).toHaveLength(2)
  })

  it('uses labels for impact estimation', () => {
    const args = parseArgs(['schedule', 'ENG-42', '--labels', 'release', 'semver'])
    const result = dispatch(args, services)
    expect(result.exitCode).toBe(0)
    const data = JSON.parse(result.output)
    expect(data.surfaces[0].domains).toContain('release')
  })

  it('uses --files for highest-confidence impact estimation', () => {
    const args = parseArgs(['schedule', 'ENG-7', '--files', 'src/db/migrate.ts'])
    const result = dispatch(args, services)
    expect(result.exitCode).toBe(0)
    const data = JSON.parse(result.output)
    expect(data.surfaces[0].files).toContain('src/db/migrate.ts')
    expect(data.surfaces[0].confidence).toBe(1.0)
  })
})

// ---------------------------------------------------------------------------
// hotspot command
// ---------------------------------------------------------------------------

describe('dispatch — hotspot', () => {
  let services: CLIServices

  beforeEach(() => {
    services = makeServices()
  })

  it('returns error when subcommand is missing', () => {
    const args = parseArgs(['hotspot'])
    const result = dispatch(args, services)
    expect(result.exitCode).toBe(1)
  })

  it('returns error when --files is missing for check', () => {
    const args = parseArgs(['hotspot', 'check'])
    const result = dispatch(args, services)
    expect(result.exitCode).toBe(1)
    expect(result.output).toMatch(/Usage/)
  })

  it('check returns touchesHotspot=true for migration files', () => {
    const args = parseArgs(['hotspot', 'check', '--files', 'src/db/migrations/001.sql'])
    const result = dispatch(args, services)
    expect(result.exitCode).toBe(0)
    const data = JSON.parse(result.output)
    expect(data.touchesHotspot).toBe(true)
    expect(data.matches[0].hotspot.name).toBe('db-migrations')
  })

  it('check returns touchesHotspot=false for unrelated files', () => {
    const args = parseArgs(['hotspot', 'check', '--files', 'src/release/branch.ts'])
    const result = dispatch(args, services)
    expect(result.exitCode).toBe(0)
    const data = JSON.parse(result.output)
    expect(data.touchesHotspot).toBe(false)
    expect(data.matches).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// lease command
// ---------------------------------------------------------------------------

describe('dispatch — lease', () => {
  let services: CLIServices

  beforeEach(() => {
    services = makeServices()
  })

  it('acquire returns not-required for non-hotspot files', () => {
    const args = parseArgs(['lease', 'acquire', '--holder', 'agent-1', '--files', 'src/release/branch.ts'])
    const result = dispatch(args, services)
    expect(result.exitCode).toBe(0)
    const data = JSON.parse(result.output)
    expect(data.status).toBe('not-required')
  })

  it('acquire grants lease for hotspot files', () => {
    const args = parseArgs([
      'lease', 'acquire',
      '--holder', 'dispatch-1',
      '--files', 'src/db/migrations/002.sql',
    ])
    const result = dispatch(args, services)
    expect(result.exitCode).toBe(0)
    const data = JSON.parse(result.output)
    expect(data.status).toBe('granted')
    expect(data.lease.holderId).toBe('dispatch-1')
  })

  it('second acquire is blocked while first is held', () => {
    const args1 = parseArgs(['lease', 'acquire', '--holder', 'dispatch-1', '--files', 'src/db/migrations/002.sql'])
    dispatch(args1, services)

    const args2 = parseArgs(['lease', 'acquire', '--holder', 'dispatch-2', '--files', 'src/db/migrations/003.sql'])
    const result = dispatch(args2, services)
    const data = JSON.parse(result.output)
    expect(data.status).toBe('blocked')
    expect(data.blockedBy.holderId).toBe('dispatch-1')
  })

  it('release by leaseId frees the hotspot', () => {
    const acqArgs = parseArgs(['lease', 'acquire', '--holder', 'dispatch-1', '--files', 'src/db/migrations/002.sql'])
    const acqResult = dispatch(acqArgs, services)
    const leaseId = JSON.parse(acqResult.output).lease.id

    const relArgs = parseArgs(['lease', 'release', '--id', leaseId])
    const relResult = dispatch(relArgs, services)
    expect(JSON.parse(relResult.output).released).toBe(true)

    // Now another agent can acquire it
    const args2 = parseArgs(['lease', 'acquire', '--holder', 'dispatch-2', '--files', 'src/db/migrations/003.sql'])
    const result2 = dispatch(args2, services)
    expect(JSON.parse(result2.output).status).toBe('granted')
  })

  it('release-holder releases all leases for a holder', () => {
    const acqArgs = parseArgs(['lease', 'acquire', '--holder', 'dispatch-1', '--files', 'src/db/migrations/002.sql'])
    dispatch(acqArgs, services)

    const relArgs = parseArgs(['lease', 'release-holder', '--holder', 'dispatch-1'])
    const result = dispatch(relArgs, services)
    expect(JSON.parse(result.output).released).toBe(1)
  })

  it('list returns active leases', () => {
    const acqArgs = parseArgs(['lease', 'acquire', '--holder', 'dispatch-1', '--files', 'src/db/migrations/002.sql'])
    dispatch(acqArgs, services)

    const listArgs = parseArgs(['lease', 'list'])
    const result = dispatch(listArgs, services)
    const data = JSON.parse(result.output)
    expect(data.count).toBe(1)
    expect(data.leases[0].holderId).toBe('dispatch-1')
  })

  it('returns error when --holder missing for acquire', () => {
    const args = parseArgs(['lease', 'acquire', '--files', 'src/db/migrations/001.sql'])
    const result = dispatch(args, services)
    expect(result.exitCode).toBe(1)
    expect(result.output).toMatch(/Usage/)
  })

  it('returns error when --id missing for release', () => {
    const args = parseArgs(['lease', 'release'])
    const result = dispatch(args, services)
    expect(result.exitCode).toBe(1)
    expect(result.output).toMatch(/Usage/)
  })
})

// ---------------------------------------------------------------------------
// help and unknown commands
// ---------------------------------------------------------------------------

describe('dispatch — help and unknown', () => {
  it('returns help text for "help" command', () => {
    const result = handleHelp()
    expect(result.exitCode).toBe(0)
    expect(result.output).toMatch(/schedule/)
    expect(result.output).toMatch(/hotspot/)
    expect(result.output).toMatch(/lease/)
  })

  it('returns help for empty command', () => {
    const services = makeServices()
    const args = parseArgs([])
    const result = dispatch(args, services)
    expect(result.exitCode).toBe(0)
    expect(result.output).toMatch(/harbormaster CLI/)
  })

  it('returns error for unknown command', () => {
    const services = makeServices()
    const args = parseArgs(['foobar'])
    const result = dispatch(args, services)
    expect(result.exitCode).toBe(1)
    expect(result.output).toMatch(/Unknown command/)
  })
})
