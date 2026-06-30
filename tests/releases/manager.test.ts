import { describe, it, expect, vi } from 'vitest'
import { ReleaseManager, createReleaseManager } from '../../src/releases/manager'
import type { ReleasePool } from '../../src/releases/types'
import type { LinearTicket } from '../../src/integrations/linear'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_ROW = {
  id: 'release-uuid-1',
  version: '1.3.0',
  branch: 'release/1.3.0',
  status: 'planning',
  linear_cycle_id: 'cycle-abc',
  manifest: null,
  notes: null,
  freeze_at: null,
  released_at: null,
  created_at: new Date('2026-06-30T00:00:00Z'),
  updated_at: new Date('2026-06-30T00:00:00Z'),
}

const SAMPLE_TICKET: LinearTicket = {
  id: 'issue-uuid-1',
  identifier: 'ENG-100',
  title: 'Ship auth flow',
  priority: 2,
  state: { id: 's1', name: 'In Progress', type: 'started' },
  labels: [{ id: 'l1', name: 'feature' }],
  assignee: { id: 'u1', name: 'Alice' },
  url: 'https://linear.app/issue/ENG-100',
}

function makePool(rowSets: unknown[][] = []): ReleasePool & { query: ReturnType<typeof vi.fn> } {
  let call = 0
  return {
    query: vi.fn((_text: string, _values?: unknown[]) => {
      const rows = rowSets[call++] ?? []
      return Promise.resolve({ rows })
    }),
  }
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe('ReleaseManager.create', () => {
  it('inserts a release row and returns a ReleaseRecord', async () => {
    const pool = makePool([[BASE_ROW]])
    const mgr = new ReleaseManager(pool)
    const rec = await mgr.create({ version: '1.3.0', branch: 'release/1.3.0', linearCycleId: 'cycle-abc' })
    expect(rec.id).toBe('release-uuid-1')
    expect(rec.version).toBe('1.3.0')
    expect(rec.status).toBe('planning')
    expect(rec.linearCycleId).toBe('cycle-abc')
  })

  it('issues an INSERT INTO releases statement', async () => {
    const pool = makePool([[BASE_ROW]])
    const mgr = new ReleaseManager(pool)
    await mgr.create({ version: '1.3.0', branch: 'release/1.3.0' })
    const [sql] = pool.query.mock.calls[0] as [string]
    expect(sql).toContain('INSERT INTO releases')
    expect(sql).toContain('RETURNING')
  })

  it('passes version, branch, cycleId, and freezeAt as positional params', async () => {
    const pool = makePool([[BASE_ROW]])
    const mgr = new ReleaseManager(pool)
    const freezeAt = new Date('2026-07-01T18:00:00Z')
    await mgr.create({ version: '1.3.0', branch: 'release/1.3.0', linearCycleId: 'c1', freezeAt })
    const [, values] = pool.query.mock.calls[0] as [string, unknown[]]
    expect(values[0]).toBe('1.3.0')
    expect(values[1]).toBe('release/1.3.0')
    expect(values[2]).toBe('c1')
    expect(values[3]).toBe(freezeAt)
  })

  it('sends null for cycleId and freezeAt when not provided', async () => {
    const pool = makePool([[BASE_ROW]])
    const mgr = new ReleaseManager(pool)
    await mgr.create({ version: '1.3.0', branch: 'release/1.3.0' })
    const [, values] = pool.query.mock.calls[0] as [string, unknown[]]
    expect(values[2]).toBeNull()
    expect(values[3]).toBeNull()
  })

  it('maps null DB columns to undefined on the returned record', async () => {
    const pool = makePool([[BASE_ROW]])
    const mgr = new ReleaseManager(pool)
    const rec = await mgr.create({ version: '1.3.0', branch: 'release/1.3.0' })
    expect(rec.manifest).toBeUndefined()
    expect(rec.notes).toBeUndefined()
    expect(rec.freezeAt).toBeUndefined()
    expect(rec.releasedAt).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// getRelease
// ---------------------------------------------------------------------------

describe('ReleaseManager.getRelease', () => {
  it('returns a record when found by id or version', async () => {
    const pool = makePool([[BASE_ROW]])
    const mgr = new ReleaseManager(pool)
    const rec = await mgr.getRelease('release-uuid-1')
    expect(rec).not.toBeNull()
    expect(rec!.version).toBe('1.3.0')
  })

  it('returns null when no row matches', async () => {
    const pool = makePool([[]])
    const mgr = new ReleaseManager(pool)
    const rec = await mgr.getRelease('nonexistent')
    expect(rec).toBeNull()
  })

  it('queries with both id and version comparison', async () => {
    const pool = makePool([[BASE_ROW]])
    const mgr = new ReleaseManager(pool)
    await mgr.getRelease('1.3.0')
    const [sql, values] = pool.query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('WHERE')
    expect(values).toContain('1.3.0')
  })
})

// ---------------------------------------------------------------------------
// buildManifest
// ---------------------------------------------------------------------------

describe('ReleaseManager.buildManifest', () => {
  it('builds a manifest with version and ticket count', () => {
    const mgr = new ReleaseManager(makePool())
    const manifest = mgr.buildManifest('1.3.0', [SAMPLE_TICKET])
    expect(manifest.version).toBe('1.3.0')
    expect(manifest.totalTickets).toBe(1)
    expect(manifest.entries).toHaveLength(1)
  })

  it('maps ticket fields to manifest entries', () => {
    const mgr = new ReleaseManager(makePool())
    const manifest = mgr.buildManifest('1.3.0', [SAMPLE_TICKET])
    const entry = manifest.entries[0]
    expect(entry.ticketId).toBe('issue-uuid-1')
    expect(entry.identifier).toBe('ENG-100')
    expect(entry.title).toBe('Ship auth flow')
    expect(entry.labels).toEqual(['feature'])
    expect(entry.priority).toBe(2)
    expect(entry.url).toBe('https://linear.app/issue/ENG-100')
  })

  it('produces an empty entries array for no tickets', () => {
    const mgr = new ReleaseManager(makePool())
    const manifest = mgr.buildManifest('1.0.0', [])
    expect(manifest.totalTickets).toBe(0)
    expect(manifest.entries).toHaveLength(0)
  })

  it('includes a generatedAt ISO timestamp', () => {
    const mgr = new ReleaseManager(makePool())
    const manifest = mgr.buildManifest('1.0.0', [])
    expect(manifest.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})

// ---------------------------------------------------------------------------
// saveManifest
// ---------------------------------------------------------------------------

describe('ReleaseManager.saveManifest', () => {
  it('throws when the release does not exist', async () => {
    const pool = makePool([[]])
    const mgr = new ReleaseManager(pool)
    await expect(mgr.saveManifest('unknown-id', [])).rejects.toThrow('Release not found')
  })

  it('issues an UPDATE with manifest and notes', async () => {
    // First call returns the row for getRelease; second call is the UPDATE
    const pool = makePool([[BASE_ROW], []])
    const mgr = new ReleaseManager(pool)
    await mgr.saveManifest('release-uuid-1', [SAMPLE_TICKET])
    const [sql] = pool.query.mock.calls[1] as [string]
    expect(sql).toContain('UPDATE releases')
    expect(sql).toContain('manifest')
    expect(sql).toContain('notes')
  })

  it('returns the generated manifest', async () => {
    const pool = makePool([[BASE_ROW], []])
    const mgr = new ReleaseManager(pool)
    const manifest = await mgr.saveManifest('release-uuid-1', [SAMPLE_TICKET])
    expect(manifest.version).toBe('1.3.0')
    expect(manifest.totalTickets).toBe(1)
    expect(manifest.entries[0].identifier).toBe('ENG-100')
  })
})

// ---------------------------------------------------------------------------
// freeze
// ---------------------------------------------------------------------------

describe('ReleaseManager.freeze', () => {
  it('updates status to frozen with a specified date', async () => {
    const pool = makePool([[]])
    const mgr = new ReleaseManager(pool)
    const at = new Date('2026-07-01T18:00:00Z')
    await mgr.freeze('release-uuid-1', at)
    const [sql, values] = pool.query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain("status = 'frozen'")
    expect(values[0]).toBe(at)
    expect(values[1]).toBe('release-uuid-1')
  })

  it('uses a current date when no date is supplied', async () => {
    const pool = makePool([[]])
    const mgr = new ReleaseManager(pool)
    const before = new Date()
    await mgr.freeze('release-uuid-1')
    const [, values] = pool.query.mock.calls[0] as [string, unknown[]]
    const after = new Date()
    const usedAt = values[0] as Date
    expect(usedAt.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(usedAt.getTime()).toBeLessThanOrEqual(after.getTime())
  })
})

// ---------------------------------------------------------------------------
// isFrozen
// ---------------------------------------------------------------------------

describe('ReleaseManager.isFrozen', () => {
  it('returns false when release is not found', async () => {
    const pool = makePool([[]])
    const mgr = new ReleaseManager(pool)
    expect(await mgr.isFrozen('missing')).toBe(false)
  })

  it('returns true when status is "frozen"', async () => {
    const row = { ...BASE_ROW, status: 'frozen', freeze_at: new Date() }
    const pool = makePool([[row]])
    const mgr = new ReleaseManager(pool)
    expect(await mgr.isFrozen('release-uuid-1')).toBe(true)
  })

  it('returns true when freeze_at is in the past and status is planning', async () => {
    const pastDate = new Date(Date.now() - 60_000)
    const row = { ...BASE_ROW, status: 'planning', freeze_at: pastDate }
    const pool = makePool([[row]])
    const mgr = new ReleaseManager(pool)
    expect(await mgr.isFrozen('release-uuid-1')).toBe(true)
  })

  it('returns false when freeze_at is in the future and status is planning', async () => {
    const futureDate = new Date(Date.now() + 3_600_000)
    const row = { ...BASE_ROW, status: 'planning', freeze_at: futureDate }
    const pool = makePool([[row]])
    const mgr = new ReleaseManager(pool)
    expect(await mgr.isFrozen('release-uuid-1')).toBe(false)
  })

  it('returns false when status is "released" and no freeze_at', async () => {
    const row = { ...BASE_ROW, status: 'released', freeze_at: null }
    const pool = makePool([[row]])
    const mgr = new ReleaseManager(pool)
    expect(await mgr.isFrozen('release-uuid-1')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// markReleased
// ---------------------------------------------------------------------------

describe('ReleaseManager.markReleased', () => {
  it('issues an UPDATE setting status to released', async () => {
    const pool = makePool([[]])
    const mgr = new ReleaseManager(pool)
    await mgr.markReleased('release-uuid-1')
    const [sql, values] = pool.query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain("status = 'released'")
    expect(sql).toContain('released_at')
    expect(values[0]).toBe('release-uuid-1')
  })
})

// ---------------------------------------------------------------------------
// createReleaseManager factory
// ---------------------------------------------------------------------------

describe('createReleaseManager', () => {
  it('returns a ReleaseManager instance', () => {
    expect(createReleaseManager(makePool())).toBeInstanceOf(ReleaseManager)
  })
})
