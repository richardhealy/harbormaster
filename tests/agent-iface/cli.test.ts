import { describe, it, expect } from 'vitest'
import { parseArgs } from '../../src/agent-iface/cli/parser'
import { runCommand } from '../../src/agent-iface/cli/runner'
import type { RunnerDeps } from '../../src/agent-iface/cli/runner'
import type { ProvenancePool } from '../../src/provenance'

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('parseArgs — schedule', () => {
  it('parses --tickets as comma-separated list', () => {
    const cmd = parseArgs(['schedule', '--tickets', 'ENG-1,ENG-2,ENG-3'])
    expect(cmd).toMatchObject({ name: 'schedule', tickets: ['ENG-1', 'ENG-2', 'ENG-3'] })
  })

  it('supports -t shorthand', () => {
    const cmd = parseArgs(['schedule', '-t', 'ENG-1,ENG-2'])
    expect(cmd).toMatchObject({ name: 'schedule', tickets: ['ENG-1', 'ENG-2'] })
  })

  it('parses --merge-threshold and --sequence-threshold', () => {
    const cmd = parseArgs(['schedule', '--tickets', 'ENG-1', '--merge-threshold', '0.8', '--sequence-threshold', '0.1'])
    expect(cmd).toMatchObject({ name: 'schedule', mergeThreshold: 0.8, sequenceThreshold: 0.1 })
  })

  it('throws when --tickets is missing', () => {
    expect(() => parseArgs(['schedule'])).toThrow(/tickets/)
  })
})

describe('parseArgs — impact', () => {
  it('parses ticket-id as first positional', () => {
    const cmd = parseArgs(['impact', 'ENG-42'])
    expect(cmd).toMatchObject({ name: 'impact', ticketId: 'ENG-42' })
  })

  it('parses --files and --labels', () => {
    const cmd = parseArgs(['impact', 'ENG-1', '--files', 'src/a.ts,src/b.ts', '--labels', 'release,db'])
    expect(cmd).toMatchObject({
      name: 'impact',
      ticketId: 'ENG-1',
      files: ['src/a.ts', 'src/b.ts'],
      labels: ['release', 'db'],
    })
  })

  it('throws when ticket-id is missing', () => {
    expect(() => parseArgs(['impact'])).toThrow(/ticket-id/)
  })
})

describe('parseArgs — lease', () => {
  it('parses lease acquire with dispatch-id and files', () => {
    const cmd = parseArgs(['lease', 'acquire', 'dispatch-1', 'src/db/migration.ts', 'src/db/schema.ts'])
    expect(cmd).toMatchObject({
      name: 'lease-acquire',
      dispatchId: 'dispatch-1',
      files: ['src/db/migration.ts', 'src/db/schema.ts'],
    })
  })

  it('parses lease acquire with --ttl flag', () => {
    const cmd = parseArgs(['lease', 'acquire', 'dispatch-1', 'file.ts', '--ttl', '30000'])
    expect(cmd).toMatchObject({ name: 'lease-acquire', ttlMs: 30000 })
  })

  it('parses lease release', () => {
    const cmd = parseArgs(['lease', 'release', 'lease-42'])
    expect(cmd).toMatchObject({ name: 'lease-release', leaseId: 'lease-42' })
  })

  it('throws when lease action is unknown', () => {
    expect(() => parseArgs(['lease', 'hold'])).toThrow(/'acquire' or 'release'/)
  })

  it('throws when lease acquire has no files', () => {
    expect(() => parseArgs(['lease', 'acquire', 'dispatch-1'])).toThrow(/file/)
  })
})

describe('parseArgs — trail', () => {
  it('parses ticket-id', () => {
    const cmd = parseArgs(['trail', 'ENG-7'])
    expect(cmd).toMatchObject({ name: 'trail', ticketId: 'ENG-7' })
  })

  it('parses --limit', () => {
    const cmd = parseArgs(['trail', 'ENG-7', '--limit', '20'])
    expect(cmd).toMatchObject({ name: 'trail', limit: 20 })
  })
})

describe('parseArgs — meta commands', () => {
  it('returns help for no args', () => {
    expect(parseArgs([])).toMatchObject({ name: 'help' })
  })

  it('returns help for --help flag', () => {
    expect(parseArgs(['--help'])).toMatchObject({ name: 'help' })
  })

  it('returns status for status command', () => {
    expect(parseArgs(['status'])).toMatchObject({ name: 'status' })
  })

  it('throws for unknown command', () => {
    expect(() => parseArgs(['frobnicate'])).toThrow(/Unknown command/)
  })
})

// ---------------------------------------------------------------------------
// runCommand
// ---------------------------------------------------------------------------

describe('runCommand — schedule', () => {
  it('returns a dispatch plan with waves', async () => {
    const result = await runCommand({ name: 'schedule', tickets: ['ENG-1', 'ENG-2'] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toMatchObject({ ticketCount: 2, waves: expect.any(Array) })
  })

  it('single ticket produces one wave with one group', async () => {
    const result = await runCommand({ name: 'schedule', tickets: ['ENG-99'] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const plan = result.data as { waves: unknown[][] }
    expect(plan.waves).toHaveLength(1)
  })
})

describe('runCommand — impact', () => {
  it('returns an impact surface with confidence 1.0 when files are given', async () => {
    const result = await runCommand({
      name: 'impact',
      ticketId: 'ENG-5',
      files: ['src/release/branch.ts', 'src/release/tags.ts'],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const surface = result.data as { confidence: number; domains: string[] }
    expect(surface.confidence).toBe(1.0)
    expect(surface.domains).toContain('release')
  })

  it('returns low-confidence surface when only title is given', async () => {
    const result = await runCommand({ name: 'impact', ticketId: 'ENG-6', title: 'scheduler refactor' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const surface = result.data as { confidence: number }
    expect(surface.confidence).toBeLessThan(1.0)
  })
})

describe('runCommand — lease', () => {
  it('returns not-required when no hotspots are configured', async () => {
    const result = await runCommand({
      name: 'lease-acquire',
      dispatchId: 'dispatch-1',
      files: ['src/normal/file.ts'],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect((result.data as { status: string }).status).toBe('not-required')
  })

  it('grants a lease when a hotspot is matched', async () => {
    const deps: RunnerDeps = {
      hotspots: [{ name: 'migrations', patterns: ['src/db/migrations/'], reason: 'db migrations' }],
    }
    const result = await runCommand(
      { name: 'lease-acquire', dispatchId: 'dispatch-2', files: ['src/db/migrations/001.sql'] },
      deps,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect((result.data as { status: string }).status).toBe('granted')
  })

  it('returns released: false for unknown lease id', async () => {
    const result = await runCommand({ name: 'lease-release', leaseId: 'no-such-lease' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect((result.data as { released: boolean }).released).toBe(false)
  })
})

describe('runCommand — trail', () => {
  it('returns error when no provenance pool is configured', async () => {
    const result = await runCommand({ name: 'trail', ticketId: 'ENG-1' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/DATABASE_URL/)
  })

  it('returns events from the provenance pool', async () => {
    const pool: ProvenancePool = {
      query: () => Promise.resolve({ rows: [] }),
    }
    const result = await runCommand({ name: 'trail', ticketId: 'ENG-1' }, { provenance: pool })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Array.isArray(result.data)).toBe(true)
  })
})

describe('runCommand — status and help', () => {
  it('status returns operational status', async () => {
    const result = await runCommand({ name: 'status' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect((result.data as { status: string }).status).toBe('operational')
  })

  it('help returns usage text', async () => {
    const result = await runCommand({ name: 'help' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect((result.data as { usage: string }).usage).toContain('harbormaster')
  })
})
