import { describe, it, expect, vi } from 'vitest'
import { ReleaseManager, createReleaseManager } from '../../src/releases/index'
import type { ReleasesPool, ReleaseLinearClient } from '../../src/releases/index'
import type { ReleaseManifest } from '../../src/releases/types'
import type { LinearTicket } from '../../src/integrations/linear/types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_ROW = {
  id: 'release-uuid-1',
  version: '1.2.0',
  branch: 'release/1.2.0',
  status: 'planning',
  linear_cycle_id: null,
  manifest: null,
  notes: null,
  freeze_at: null,
  released_at: null,
  created_at: new Date('2024-06-01T00:00:00Z'),
  updated_at: new Date('2024-06-01T00:00:00Z'),
}

const TICKET: LinearTicket = {
  id: 'issue-1',
  identifier: 'ENG-1',
  title: 'Add OAuth flow',
  description: 'Implement OAuth2 login',
  state: { id: 'state-1', name: 'Done', type: 'completed' },
  priority: 2,
  labels: [{ id: 'l1', name: 'feat' }],
  assignee: { id: 'u1', name: 'Alice' },
  url: 'https://linear.app/issue/ENG-1',
}

const SAMPLE_MANIFEST: ReleaseManifest = {
  releaseId: 'release-uuid-1',
  version: '1.2.0',
  generatedAt: '2024-06-01T00:00:00.000Z',
  tickets: [
    {
      id: 'issue-1',
      identifier: 'ENG-1',
      title: 'Add OAuth flow',
      status: 'Done',
      priority: 2,
      labels: ['feat'],
      assignee: 'Alice',
      url: 'https://linear.app/issue/ENG-1',
    },
    {
      id: 'issue-2',
      identifier: 'ENG-2',
      title: 'Fix login crash',
      status: 'Done',
      priority: 1,
      labels: ['bug'],
      url: 'https://linear.app/issue/ENG-2',
    },
    {
      id: 'issue-3',
      identifier: 'ENG-3',
      title: 'Update deps',
      status: 'Done',
      priority: 3,
      labels: ['chore'],
    },
    {
      id: 'issue-4',
      identifier: 'ENG-4',
      title: 'Random task',
      status: 'Done',
      priority: 4,
      labels: [],
    },
  ],
  summary: { total: 4, byStatus: { Done: 4 }, byPriority: { 1: 1, 2: 1, 3: 1, 4: 1 } },
}

function makePool(rowSets: unknown[][] = []): ReleasesPool & { query: ReturnType<typeof vi.fn> } {
  let call = 0
  return {
    query: vi.fn(() => {
      const rows = rowSets[call++] ?? []
      return Promise.resolve({ rows })
    }),
  }
}

function makeLinear(tickets: LinearTicket[] = []): ReleaseLinearClient {
  return { listTeamIssues: vi.fn().mockResolvedValue(tickets) }
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe('ReleaseManager.create', () => {
  it('sends INSERT INTO releases with RETURNING *', async () => {
    const pool = makePool([[BASE_ROW]])
    const mgr = new ReleaseManager(pool)
    await mgr.create('1.2.0', { branch: 'release/1.2.0' })
    const [sql] = pool.query.mock.calls[0] as [string]
    expect(sql).toContain('INSERT INTO releases')
    expect(sql).toContain('RETURNING *')
  })

  it('passes version, branch, and planning status as parameters', async () => {
    const pool = makePool([[BASE_ROW]])
    const mgr = new ReleaseManager(pool)
    await mgr.create('1.2.0', { branch: 'release/1.2.0' })
    const [, values] = pool.query.mock.calls[0] as [string, unknown[]]
    expect(values[0]).toBe('1.2.0')
    expect(values[1]).toBe('release/1.2.0')
  })

  it('sets linear_cycle_id to null when not provided', async () => {
    const pool = makePool([[BASE_ROW]])
    const mgr = new ReleaseManager(pool)
    await mgr.create('1.2.0', { branch: 'release/1.2.0' })
    const [, values] = pool.query.mock.calls[0] as [string, unknown[]]
    expect(values[2]).toBeNull()
  })

  it('passes linearCycleId when provided', async () => {
    const pool = makePool([[{ ...BASE_ROW, linear_cycle_id: 'cycle-99' }]])
    const mgr = new ReleaseManager(pool)
    await mgr.create('1.2.0', { branch: 'release/1.2.0', linearCycleId: 'cycle-99' })
    const [, values] = pool.query.mock.calls[0] as [string, unknown[]]
    expect(values[2]).toBe('cycle-99')
  })

  it('returns a mapped ReleaseRecord', async () => {
    const pool = makePool([[BASE_ROW]])
    const mgr = new ReleaseManager(pool)
    const record = await mgr.create('1.2.0', { branch: 'release/1.2.0' })
    expect(record.id).toBe('release-uuid-1')
    expect(record.version).toBe('1.2.0')
    expect(record.status).toBe('planning')
    expect(record.createdAt).toBeInstanceOf(Date)
  })
})

// ---------------------------------------------------------------------------
// getRelease
// ---------------------------------------------------------------------------

describe('ReleaseManager.getRelease', () => {
  it('queries by id and returns a mapped record', async () => {
    const pool = makePool([[BASE_ROW]])
    const mgr = new ReleaseManager(pool)
    const record = await mgr.getRelease('release-uuid-1')
    expect(record).not.toBeNull()
    expect(record!.id).toBe('release-uuid-1')
    expect(record!.branch).toBe('release/1.2.0')
  })

  it('returns null when no row is found', async () => {
    const pool = makePool([[]])
    const mgr = new ReleaseManager(pool)
    expect(await mgr.getRelease('does-not-exist')).toBeNull()
  })

  it('maps optional fields: freezeAt and linearCycleId', async () => {
    const freezeAt = new Date('2024-07-01T12:00:00Z')
    const row = { ...BASE_ROW, freeze_at: freezeAt, linear_cycle_id: 'cycle-5' }
    const pool = makePool([[row]])
    const mgr = new ReleaseManager(pool)
    const record = await mgr.getRelease('release-uuid-1')
    expect(record!.freezeAt).toBeInstanceOf(Date)
    expect(record!.linearCycleId).toBe('cycle-5')
  })
})

// ---------------------------------------------------------------------------
// updateStatus
// ---------------------------------------------------------------------------

describe('ReleaseManager.updateStatus', () => {
  it('issues an UPDATE with the new status', async () => {
    const pool = makePool([[]])
    const mgr = new ReleaseManager(pool)
    await mgr.updateStatus('release-uuid-1', 'in_progress')
    const [sql, values] = pool.query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('UPDATE releases')
    expect(values[0]).toBe('in_progress')
    expect(values[1]).toBe('release-uuid-1')
  })

  it('adds released_at = NOW() clause when status is released', async () => {
    const pool = makePool([[]])
    const mgr = new ReleaseManager(pool)
    await mgr.updateStatus('release-uuid-1', 'released')
    const [sql] = pool.query.mock.calls[0] as [string]
    expect(sql).toContain('released_at')
  })

  it('omits released_at clause for other statuses', async () => {
    for (const status of ['planning', 'in_progress', 'frozen', 'cancelled'] as const) {
      const pool = makePool([[]])
      const mgr = new ReleaseManager(pool)
      await mgr.updateStatus('release-uuid-1', status)
      const [sql] = pool.query.mock.calls[0] as [string]
      expect(sql).not.toContain('released_at')
    }
  })
})

// ---------------------------------------------------------------------------
// setFreezeWindow
// ---------------------------------------------------------------------------

describe('ReleaseManager.setFreezeWindow', () => {
  const freezeAt = new Date('2024-07-01T00:00:00Z')

  it('sends UPDATE with freeze_at and status frozen', async () => {
    const pool = makePool([[]])
    const mgr = new ReleaseManager(pool)
    await mgr.setFreezeWindow('release-uuid-1', freezeAt)
    const [sql, values] = pool.query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('freeze_at')
    expect(sql).toContain("'frozen'")
    expect(values[0]).toBe(freezeAt)
    expect(values[1]).toBe('release-uuid-1')
  })

  it('includes updated_at = NOW() in the UPDATE', async () => {
    const pool = makePool([[]])
    const mgr = new ReleaseManager(pool)
    await mgr.setFreezeWindow('release-uuid-1', freezeAt)
    const [sql] = pool.query.mock.calls[0] as [string]
    expect(sql).toContain('updated_at')
  })
})

// ---------------------------------------------------------------------------
// isInFreezeWindow
// ---------------------------------------------------------------------------

describe('ReleaseManager.isInFreezeWindow', () => {
  it('returns false when freeze_at is null', async () => {
    const pool = makePool([[{ freeze_at: null }]])
    const mgr = new ReleaseManager(pool)
    expect(await mgr.isInFreezeWindow('release-uuid-1', new Date())).toBe(false)
  })

  it('returns false when current time is before freeze_at', async () => {
    const freezeAt = new Date('2024-07-01T12:00:00Z')
    const pool = makePool([[{ freeze_at: freezeAt }]])
    const mgr = new ReleaseManager(pool)
    const before = new Date('2024-06-30T00:00:00Z')
    expect(await mgr.isInFreezeWindow('release-uuid-1', before)).toBe(false)
  })

  it('returns true when current time equals freeze_at', async () => {
    const freezeAt = new Date('2024-07-01T12:00:00Z')
    const pool = makePool([[{ freeze_at: freezeAt }]])
    const mgr = new ReleaseManager(pool)
    expect(await mgr.isInFreezeWindow('release-uuid-1', new Date(freezeAt))).toBe(true)
  })

  it('returns true when current time is after freeze_at', async () => {
    const freezeAt = new Date('2024-07-01T12:00:00Z')
    const pool = makePool([[{ freeze_at: freezeAt }]])
    const mgr = new ReleaseManager(pool)
    const after = new Date('2024-07-02T00:00:00Z')
    expect(await mgr.isInFreezeWindow('release-uuid-1', after)).toBe(true)
  })

  it('queries with the correct release id', async () => {
    const pool = makePool([[{ freeze_at: null }]])
    const mgr = new ReleaseManager(pool)
    await mgr.isInFreezeWindow('release-uuid-1', new Date())
    const [, values] = pool.query.mock.calls[0] as [string, unknown[]]
    expect(values[0]).toBe('release-uuid-1')
  })
})

// ---------------------------------------------------------------------------
// buildManifest
// ---------------------------------------------------------------------------

describe('ReleaseManager.buildManifest', () => {
  it('throws when release is not found', async () => {
    const pool = makePool([[]])
    const mgr = new ReleaseManager(pool)
    await expect(mgr.buildManifest('missing-id', makeLinear(), 'team-1')).rejects.toThrow(
      'missing-id',
    )
  })

  it('calls listTeamIssues with the provided teamId', async () => {
    const pool = makePool([[BASE_ROW], []])
    const linear = makeLinear([TICKET])
    const mgr = new ReleaseManager(pool)
    await mgr.buildManifest('release-uuid-1', linear, 'team-eng')
    expect(linear.listTeamIssues).toHaveBeenCalledWith('team-eng', {})
  })

  it('maps Linear ticket fields to ManifestTicket shape', async () => {
    const pool = makePool([[BASE_ROW], []])
    const mgr = new ReleaseManager(pool)
    const manifest = await mgr.buildManifest('release-uuid-1', makeLinear([TICKET]), 'team-1')
    const t = manifest.tickets[0]
    expect(t.id).toBe('issue-1')
    expect(t.identifier).toBe('ENG-1')
    expect(t.title).toBe('Add OAuth flow')
    expect(t.status).toBe('Done')
    expect(t.labels).toEqual(['feat'])
    expect(t.assignee).toBe('Alice')
    expect(t.url).toBe('https://linear.app/issue/ENG-1')
  })

  it('builds correct summary counts', async () => {
    const t2: LinearTicket = {
      ...TICKET,
      id: 'issue-2',
      identifier: 'ENG-2',
      title: 'Fix crash',
      priority: 1,
      state: { id: 'state-2', name: 'Done', type: 'completed' },
    }
    const pool = makePool([[BASE_ROW], []])
    const mgr = new ReleaseManager(pool)
    const manifest = await mgr.buildManifest('release-uuid-1', makeLinear([TICKET, t2]), 'team-1')
    expect(manifest.summary.total).toBe(2)
    expect(manifest.summary.byStatus['Done']).toBe(2)
    expect(manifest.summary.byPriority[2]).toBe(1)
    expect(manifest.summary.byPriority[1]).toBe(1)
  })

  it('persists the manifest to the database', async () => {
    const pool = makePool([[BASE_ROW], []])
    const mgr = new ReleaseManager(pool)
    await mgr.buildManifest('release-uuid-1', makeLinear([TICKET]), 'team-1')
    const updateCall = pool.query.mock.calls[1] as [string, unknown[]]
    expect(updateCall[0]).toContain('UPDATE releases SET manifest')
    expect(updateCall[1][1]).toBe('release-uuid-1')
  })

  it('passes label filter to listTeamIssues when provided', async () => {
    const pool = makePool([[BASE_ROW], []])
    const linear = makeLinear([])
    const mgr = new ReleaseManager(pool)
    await mgr.buildManifest('release-uuid-1', linear, 'team-1', ['v1.2.0'])
    expect(linear.listTeamIssues).toHaveBeenCalledWith(
      'team-1',
      { filter: { label: { name: { in: ['v1.2.0'] } } } },
    )
  })

  it('includes release version and releaseId in manifest', async () => {
    const pool = makePool([[BASE_ROW], []])
    const mgr = new ReleaseManager(pool)
    const manifest = await mgr.buildManifest('release-uuid-1', makeLinear([TICKET]), 'team-1')
    expect(manifest.version).toBe('1.2.0')
    expect(manifest.releaseId).toBe('release-uuid-1')
  })
})

// ---------------------------------------------------------------------------
// generateNotes
// ---------------------------------------------------------------------------

describe('ReleaseManager.generateNotes', () => {
  it('includes a version heading', () => {
    const mgr = new ReleaseManager(makePool())
    const notes = mgr.generateNotes(SAMPLE_MANIFEST)
    expect(notes).toContain('# Release 1.2.0')
  })

  it('includes the total ticket count', () => {
    const mgr = new ReleaseManager(makePool())
    const notes = mgr.generateNotes(SAMPLE_MANIFEST)
    expect(notes).toContain('Tickets: 4')
  })

  it('classifies feat-labeled tickets under Features', () => {
    const mgr = new ReleaseManager(makePool())
    const notes = mgr.generateNotes(SAMPLE_MANIFEST)
    expect(notes).toContain('## Features')
    expect(notes).toContain('Add OAuth flow')
  })

  it('classifies bug-labeled tickets under Fixes', () => {
    const mgr = new ReleaseManager(makePool())
    const notes = mgr.generateNotes(SAMPLE_MANIFEST)
    expect(notes).toContain('## Fixes')
    expect(notes).toContain('Fix login crash')
  })

  it('classifies chore-labeled tickets under Improvements', () => {
    const mgr = new ReleaseManager(makePool())
    const notes = mgr.generateNotes(SAMPLE_MANIFEST)
    expect(notes).toContain('## Improvements')
    expect(notes).toContain('Update deps')
  })

  it('places unlabeled tickets under Other', () => {
    const mgr = new ReleaseManager(makePool())
    const notes = mgr.generateNotes(SAMPLE_MANIFEST)
    expect(notes).toContain('## Other')
    expect(notes).toContain('Random task')
  })

  it('renders a markdown link when ticket has a url', () => {
    const mgr = new ReleaseManager(makePool())
    const notes = mgr.generateNotes(SAMPLE_MANIFEST)
    expect(notes).toContain('[ENG-1](https://linear.app/issue/ENG-1)')
  })

  it('renders plain identifier when ticket has no url', () => {
    const mgr = new ReleaseManager(makePool())
    const notes = mgr.generateNotes(SAMPLE_MANIFEST)
    expect(notes).toMatch(/- ENG-4 Random task/)
  })

  it('omits sections that have no tickets', () => {
    const mgr = new ReleaseManager(makePool())
    const onlyFeats: ReleaseManifest = {
      ...SAMPLE_MANIFEST,
      tickets: [SAMPLE_MANIFEST.tickets[0]],
      summary: { total: 1, byStatus: { Done: 1 }, byPriority: { 2: 1 } },
    }
    const notes = mgr.generateNotes(onlyFeats)
    expect(notes).not.toContain('## Fixes')
    expect(notes).not.toContain('## Other')
  })
})

// ---------------------------------------------------------------------------
// saveNotes
// ---------------------------------------------------------------------------

describe('ReleaseManager.saveNotes', () => {
  it('sends UPDATE releases SET notes', async () => {
    const pool = makePool([[]])
    const mgr = new ReleaseManager(pool)
    await mgr.saveNotes('release-uuid-1', '# Release 1.2.0\n')
    const [sql] = pool.query.mock.calls[0] as [string]
    expect(sql).toContain('UPDATE releases SET notes')
  })

  it('passes notes text and releaseId as parameters', async () => {
    const pool = makePool([[]])
    const mgr = new ReleaseManager(pool)
    await mgr.saveNotes('release-uuid-1', '# Release 1.2.0\n')
    const [, values] = pool.query.mock.calls[0] as [string, unknown[]]
    expect(values[0]).toBe('# Release 1.2.0\n')
    expect(values[1]).toBe('release-uuid-1')
  })
})

// ---------------------------------------------------------------------------
// listReleases
// ---------------------------------------------------------------------------

describe('ReleaseManager.listReleases', () => {
  it('returns all releases ordered by created_at when no status given', async () => {
    const pool = makePool([[BASE_ROW]])
    const mgr = new ReleaseManager(pool)
    const records = await mgr.listReleases()
    expect(records).toHaveLength(1)
    expect(records[0].id).toBe('release-uuid-1')
    const [sql] = pool.query.mock.calls[0] as [string]
    expect(sql).not.toContain('WHERE')
    expect(sql).toContain('ORDER BY created_at DESC')
  })

  it('filters by status when provided', async () => {
    const pool = makePool([[BASE_ROW]])
    const mgr = new ReleaseManager(pool)
    await mgr.listReleases('planning')
    const [sql, values] = pool.query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('WHERE status')
    expect(values[0]).toBe('planning')
  })

  it('returns empty array when no rows match', async () => {
    const pool = makePool([[]])
    const mgr = new ReleaseManager(pool)
    expect(await mgr.listReleases('released')).toHaveLength(0)
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
