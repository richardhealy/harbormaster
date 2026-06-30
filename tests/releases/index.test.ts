import { describe, it, expect, vi } from 'vitest'
import { ReleasePlanner, createReleasePlanner, PRIORITY_LABELS } from '../../src/releases/index'
import type {
  ReleasePlannerPool,
  LinearSource,
  ReleaseManifest,
  ReleaseManifestEntry,
} from '../../src/releases/index'
import type { ProvenanceRecorder } from '../../src/provenance/index'
import type { LinearTicket } from '../../src/integrations/linear/index'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW_ISO = '2024-06-15T10:00:00.000Z'
const FAKE_CLOCK = () => NOW_ISO

function makeTicket(overrides: Partial<LinearTicket> = {}): LinearTicket {
  return {
    id: 'ticket-1',
    identifier: 'ENG-1',
    title: 'Add auth module',
    state: { id: 'state-1', name: 'Done', type: 'completed' },
    priority: 2,
    labels: [{ id: 'lbl-1', name: 'feature' }],
    assignee: { id: 'user-1', name: 'Alice' },
    url: 'https://linear.app/team/issue/ENG-1',
    ...overrides,
  }
}

const RAW_RELEASE_ROW = {
  id: 'rel-1',
  version: '1.2.0',
  branch: 'release/1.2.0',
  status: 'planning',
  linear_cycle_id: null,
  manifest: null,
  notes: null,
  freeze_at: null,
  released_at: null,
  created_at: new Date('2024-06-10T08:00:00Z'),
  updated_at: new Date('2024-06-10T08:00:00Z'),
}

function makePool(rowSets: unknown[][] = []): ReleasePlannerPool & { query: ReturnType<typeof vi.fn> } {
  let call = 0
  return {
    query: vi.fn((_text: string, _values?: unknown[]) => {
      const rows = rowSets[call++] ?? []
      return Promise.resolve({ rows })
    }),
  }
}

function makeLinear(tickets: LinearTicket[] = []): LinearSource & { listTeamIssues: ReturnType<typeof vi.fn> } {
  return { listTeamIssues: vi.fn().mockResolvedValue(tickets) }
}

function makeProvenance(): ProvenanceRecorder {
  return {
    record: vi.fn().mockResolvedValue('audit-1'),
    query: vi.fn().mockResolvedValue([]),
    queryByTicket: vi.fn().mockResolvedValue([]),
    queryByDispatch: vi.fn().mockResolvedValue([]),
    getTrail: vi.fn().mockResolvedValue([]),
  } as unknown as ProvenanceRecorder
}

// ---------------------------------------------------------------------------
// PRIORITY_LABELS
// ---------------------------------------------------------------------------

describe('PRIORITY_LABELS', () => {
  it('maps 0-4 to human labels', () => {
    expect(PRIORITY_LABELS[0]).toBe('none')
    expect(PRIORITY_LABELS[1]).toBe('urgent')
    expect(PRIORITY_LABELS[2]).toBe('high')
    expect(PRIORITY_LABELS[3]).toBe('medium')
    expect(PRIORITY_LABELS[4]).toBe('low')
  })
})

// ---------------------------------------------------------------------------
// createRelease
// ---------------------------------------------------------------------------

describe('ReleasePlanner.createRelease', () => {
  it('inserts a release row and returns a ReleaseRecord', async () => {
    const pool = makePool([[RAW_RELEASE_ROW]])
    const planner = new ReleasePlanner(pool, makeLinear(), makeProvenance(), FAKE_CLOCK)

    const record = await planner.createRelease('1.2.0', 'release/1.2.0')
    expect(record.id).toBe('rel-1')
    expect(record.version).toBe('1.2.0')
    expect(record.status).toBe('planning')
  })

  it('includes INSERT INTO releases in the SQL', async () => {
    const pool = makePool([[RAW_RELEASE_ROW]])
    const planner = new ReleasePlanner(pool, makeLinear(), makeProvenance(), FAKE_CLOCK)
    await planner.createRelease('1.2.0', 'release/1.2.0')

    const [sql] = pool.query.mock.calls[0] as [string]
    expect(sql).toContain('INSERT INTO releases')
  })

  it('records a release.created provenance event', async () => {
    const pool = makePool([[RAW_RELEASE_ROW]])
    const prov = makeProvenance()
    const planner = new ReleasePlanner(pool, makeLinear(), prov, FAKE_CLOCK)
    await planner.createRelease('1.2.0', 'release/1.2.0')

    expect(prov.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'release.created' }),
    )
  })

  it('stores linearCycleId and freezeAt when provided', async () => {
    const freezeAt = new Date('2024-07-01T00:00:00Z')
    const row = { ...RAW_RELEASE_ROW, linear_cycle_id: 'cycle-123', freeze_at: freezeAt }
    const pool = makePool([[row]])
    const planner = new ReleasePlanner(pool, makeLinear(), makeProvenance(), FAKE_CLOCK)

    const record = await planner.createRelease('1.2.0', 'release/1.2.0', {
      linearCycleId: 'cycle-123',
      freezeAt,
    })
    expect(record.linearCycleId).toBe('cycle-123')
    expect(record.freezeAt).toEqual(freezeAt)
  })
})

// ---------------------------------------------------------------------------
// buildManifest
// ---------------------------------------------------------------------------

describe('ReleasePlanner.buildManifest', () => {
  it('fetches tickets from Linear and builds a manifest', async () => {
    const ticket = makeTicket()
    // pool calls: SELECT version, UPDATE manifest
    const pool = makePool([[{ version: '1.2.0' }], []])
    const linear = makeLinear([ticket])
    const planner = new ReleasePlanner(pool, linear, makeProvenance(), FAKE_CLOCK)

    const manifest = await planner.buildManifest('rel-1', 'team-abc')
    expect(manifest.totalTickets).toBe(1)
    expect(manifest.tickets[0].identifier).toBe('ENG-1')
    expect(manifest.tickets[0].priorityLabel).toBe('high')
    expect(manifest.version).toBe('1.2.0')
    expect(manifest.generatedAt).toBe(NOW_ISO)
  })

  it('groups tickets by priority', async () => {
    const t1 = makeTicket({ id: 'a', identifier: 'ENG-1', priority: 1 })
    const t2 = makeTicket({ id: 'b', identifier: 'ENG-2', priority: 1 })
    const t3 = makeTicket({ id: 'c', identifier: 'ENG-3', priority: 3 })
    const pool = makePool([[{ version: '1.0.0' }], []])
    const linear = makeLinear([t1, t2, t3])
    const planner = new ReleasePlanner(pool, linear, makeProvenance(), FAKE_CLOCK)

    const manifest = await planner.buildManifest('rel-1', 'team-abc')
    expect(manifest.byPriority['urgent']).toHaveLength(2)
    expect(manifest.byPriority['medium']).toHaveLength(1)
  })

  it('groups tickets by label', async () => {
    const t1 = makeTicket({ id: 'a', labels: [{ id: 'l1', name: 'bug' }] })
    const t2 = makeTicket({ id: 'b', labels: [{ id: 'l1', name: 'bug' }, { id: 'l2', name: 'frontend' }] })
    const pool = makePool([[{ version: '1.0.0' }], []])
    const linear = makeLinear([t1, t2])
    const planner = new ReleasePlanner(pool, linear, makeProvenance(), FAKE_CLOCK)

    const manifest = await planner.buildManifest('rel-1', 'team-abc')
    expect(manifest.byLabel['bug']).toHaveLength(2)
    expect(manifest.byLabel['frontend']).toHaveLength(1)
  })

  it('puts tickets with no labels into unlabelled group', async () => {
    const t = makeTicket({ labels: [] })
    const pool = makePool([[{ version: '1.0.0' }], []])
    const linear = makeLinear([t])
    const planner = new ReleasePlanner(pool, linear, makeProvenance(), FAKE_CLOCK)

    const manifest = await planner.buildManifest('rel-1', 'team-abc')
    expect(manifest.byLabel['unlabelled']).toHaveLength(1)
  })

  it('passes labelFilter to Linear when provided', async () => {
    const pool = makePool([[{ version: '1.0.0' }], []])
    const linear = makeLinear([])
    const planner = new ReleasePlanner(pool, linear, makeProvenance(), FAKE_CLOCK)

    await planner.buildManifest('rel-1', 'team-abc', { labelFilter: 'v1.2' })
    const callArgs = linear.listTeamIssues.mock.calls[0] as [string, { filter?: unknown }]
    expect(callArgs[1].filter).toMatchObject({ label: { name: { in: ['v1.2'] } } })
  })

  it('persists manifest to the DB', async () => {
    const pool = makePool([[{ version: '1.0.0' }], []])
    const linear = makeLinear([makeTicket()])
    const planner = new ReleasePlanner(pool, linear, makeProvenance(), FAKE_CLOCK)

    await planner.buildManifest('rel-1', 'team-abc')
    // call 0 = SELECT version, call 1 = UPDATE manifest
    const [updateSql] = pool.query.mock.calls[1] as [string]
    expect(updateSql).toContain('UPDATE releases')
    expect(updateSql).toContain('manifest')
  })

  it('returns manifest with version from DB even when SELECT returns nothing', async () => {
    const pool = makePool([[], []])  // call 0 = SELECT version (empty), call 1 = UPDATE manifest
    const linear = makeLinear([makeTicket()])
    const planner = new ReleasePlanner(pool, linear, makeProvenance(), FAKE_CLOCK)

    const manifest = await planner.buildManifest('rel-1', 'team-abc')
    expect(manifest.version).toBe('')
  })
})

// ---------------------------------------------------------------------------
// generateNotes
// ---------------------------------------------------------------------------

describe('ReleasePlanner.generateNotes', () => {
  it('produces a markdown document with version heading', () => {
    const planner = new ReleasePlanner(makePool(), makeLinear(), makeProvenance(), FAKE_CLOCK)

    const manifest: ReleaseManifest = {
      version: '1.2.0',
      generatedAt: NOW_ISO,
      totalTickets: 2,
      tickets: [],
      byPriority: {
        high: [
          {
            ticketId: 'a',
            identifier: 'ENG-1',
            title: 'Auth module',
            state: 'Done',
            priority: 2,
            priorityLabel: 'high',
            labels: ['feature'],
            assignee: 'Alice',
            url: 'https://linear.app/issue/ENG-1',
          },
        ],
        medium: [
          {
            ticketId: 'b',
            identifier: 'ENG-2',
            title: 'Fix tooltip',
            state: 'Done',
            priority: 3,
            priorityLabel: 'medium',
            labels: [],
          },
        ],
      },
      byLabel: {},
    }

    const notes = planner.generateNotes(manifest)
    expect(notes).toContain('# Release 1.2.0')
    expect(notes).toContain('## High priority')
    expect(notes).toContain('## Medium priority')
    expect(notes).toContain('ENG-1')
    expect(notes).toContain('Auth module')
    expect(notes).toContain('Alice')
    expect(notes).toContain('[ENG-1](https://linear.app/issue/ENG-1)')
  })

  it('skips empty priority groups', () => {
    const planner = new ReleasePlanner(makePool(), makeLinear(), makeProvenance(), FAKE_CLOCK)
    const manifest: ReleaseManifest = {
      version: '2.0.0',
      generatedAt: NOW_ISO,
      totalTickets: 0,
      tickets: [],
      byPriority: {},
      byLabel: {},
    }
    const notes = planner.generateNotes(manifest)
    expect(notes).not.toContain('## High priority')
    expect(notes).not.toContain('## Urgent priority')
  })

  it('renders tickets without assignee cleanly', () => {
    const planner = new ReleasePlanner(makePool(), makeLinear(), makeProvenance(), FAKE_CLOCK)
    const entry: ReleaseManifestEntry = {
      ticketId: 'c',
      identifier: 'ENG-3',
      title: 'Update deps',
      state: 'Done',
      priority: 4,
      priorityLabel: 'low',
      labels: [],
    }
    const manifest: ReleaseManifest = {
      version: '1.0.0',
      generatedAt: NOW_ISO,
      totalTickets: 1,
      tickets: [entry],
      byPriority: { low: [entry] },
      byLabel: {},
    }
    const notes = planner.generateNotes(manifest)
    expect(notes).toContain('ENG-3')
    expect(notes).not.toContain('undefined')
    expect(notes).not.toContain(' — \n')
  })
})

// ---------------------------------------------------------------------------
// setFreezeWindow / isFrozen
// ---------------------------------------------------------------------------

describe('ReleasePlanner.setFreezeWindow', () => {
  it('issues an UPDATE releases SET freeze_at query', async () => {
    const pool = makePool([[]])
    const planner = new ReleasePlanner(pool, makeLinear(), makeProvenance(), FAKE_CLOCK)
    const at = new Date('2024-07-01T00:00:00Z')
    await planner.setFreezeWindow('rel-1', at)

    const [sql] = pool.query.mock.calls[0] as [string]
    expect(sql).toContain('UPDATE releases')
    expect(sql).toContain('freeze_at')
  })
})

describe('ReleasePlanner.isFrozen', () => {
  it('returns true when status is "frozen"', async () => {
    const pool = makePool([[{ status: 'frozen', freeze_at: null }]])
    const planner = new ReleasePlanner(pool, makeLinear(), makeProvenance(), FAKE_CLOCK)
    expect(await planner.isFrozen('rel-1')).toBe(true)
  })

  it('returns true when freeze_at has passed', async () => {
    const past = new Date(Date.now() - 60_000)
    const pool = makePool([[{ status: 'active', freeze_at: past }]])
    const planner = new ReleasePlanner(pool, makeLinear(), makeProvenance(), FAKE_CLOCK)
    expect(await planner.isFrozen('rel-1')).toBe(true)
  })

  it('returns false when freeze_at is in the future', async () => {
    const future = new Date(Date.now() + 60_000)
    const pool = makePool([[{ status: 'active', freeze_at: future }]])
    const planner = new ReleasePlanner(pool, makeLinear(), makeProvenance(), FAKE_CLOCK)
    expect(await planner.isFrozen('rel-1')).toBe(false)
  })

  it('returns false when release is not found', async () => {
    const pool = makePool([[]])
    const planner = new ReleasePlanner(pool, makeLinear(), makeProvenance(), FAKE_CLOCK)
    expect(await planner.isFrozen('missing')).toBe(false)
  })

  it('returns false when status is active and no freeze_at', async () => {
    const pool = makePool([[{ status: 'active', freeze_at: null }]])
    const planner = new ReleasePlanner(pool, makeLinear(), makeProvenance(), FAKE_CLOCK)
    expect(await planner.isFrozen('rel-1')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// activateRelease / publishRelease
// ---------------------------------------------------------------------------

describe('ReleasePlanner.activateRelease', () => {
  it('updates status to active', async () => {
    const pool = makePool([[]])
    const planner = new ReleasePlanner(pool, makeLinear(), makeProvenance(), FAKE_CLOCK)
    await planner.activateRelease('rel-1')

    const [sql] = pool.query.mock.calls[0] as [string]
    expect(sql).toContain("status = 'active'")
  })
})

describe('ReleasePlanner.publishRelease', () => {
  it('sets status to released and records provenance', async () => {
    const pool = makePool([[{ version: '1.2.0', branch: 'release/1.2.0' }]])
    const prov = makeProvenance()
    const planner = new ReleasePlanner(pool, makeLinear(), prov, FAKE_CLOCK)
    await planner.publishRelease('rel-1')

    const [sql] = pool.query.mock.calls[0] as [string]
    expect(sql).toContain("status = 'released'")
    expect(prov.record).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'release.tagged' }),
    )
  })

  it('does not record provenance when release is not found', async () => {
    const pool = makePool([[]])
    const prov = makeProvenance()
    const planner = new ReleasePlanner(pool, makeLinear(), prov, FAKE_CLOCK)
    await planner.publishRelease('missing')
    expect(prov.record).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// getRelease / listReleases
// ---------------------------------------------------------------------------

describe('ReleasePlanner.getRelease', () => {
  it('returns null when not found', async () => {
    const pool = makePool([[]])
    const planner = new ReleasePlanner(pool, makeLinear(), makeProvenance(), FAKE_CLOCK)
    expect(await planner.getRelease('missing')).toBeNull()
  })

  it('returns a ReleaseRecord when found', async () => {
    const pool = makePool([[RAW_RELEASE_ROW]])
    const planner = new ReleasePlanner(pool, makeLinear(), makeProvenance(), FAKE_CLOCK)
    const record = await planner.getRelease('rel-1')
    expect(record?.version).toBe('1.2.0')
  })
})

describe('ReleasePlanner.listReleases', () => {
  it('returns all releases when no status filter', async () => {
    const pool = makePool([[RAW_RELEASE_ROW, { ...RAW_RELEASE_ROW, id: 'rel-2', version: '1.1.0' }]])
    const planner = new ReleasePlanner(pool, makeLinear(), makeProvenance(), FAKE_CLOCK)
    const records = await planner.listReleases()
    expect(records).toHaveLength(2)
  })

  it('filters by status when provided', async () => {
    const pool = makePool([[RAW_RELEASE_ROW]])
    const planner = new ReleasePlanner(pool, makeLinear(), makeProvenance(), FAKE_CLOCK)
    await planner.listReleases('planning')

    const [sql, values] = pool.query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('WHERE status =')
    expect(values).toContain('planning')
  })
})

// ---------------------------------------------------------------------------
// updateNotes
// ---------------------------------------------------------------------------

describe('ReleasePlanner.updateNotes', () => {
  it('issues an UPDATE releases SET notes query', async () => {
    const pool = makePool([[]])
    const planner = new ReleasePlanner(pool, makeLinear(), makeProvenance(), FAKE_CLOCK)
    await planner.updateNotes('rel-1', '## What changed\n- Fixed bug')

    const [sql] = pool.query.mock.calls[0] as [string]
    expect(sql).toContain('UPDATE releases')
    expect(sql).toContain('notes')
  })
})

// ---------------------------------------------------------------------------
// createReleasePlanner factory
// ---------------------------------------------------------------------------

describe('createReleasePlanner', () => {
  it('returns a ReleasePlanner instance', () => {
    const planner = createReleasePlanner(makePool(), makeLinear(), makeProvenance())
    expect(planner).toBeInstanceOf(ReleasePlanner)
  })
})
