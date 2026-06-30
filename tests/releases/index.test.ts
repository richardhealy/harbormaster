import { describe, it, expect, vi } from 'vitest'
import {
  ReleaseManager,
  ManifestBuilder,
  ReleaseNotesGenerator,
  ReleasePlanner,
  FreezeWindowManager,
  createReleaseManager,
} from '../../src/releases/index'
import type { ReleasesPool, Release, ReleaseManifest } from '../../src/releases/index'
import type { LinearTicket } from '../../src/integrations/linear/types'
import type { FetchFn } from '../../src/integrations/linear/index'
import { LinearClient } from '../../src/integrations/linear/index'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW_ISO = '2024-07-01T12:00:00.000Z'
const NOW = new Date(NOW_ISO)

function makeTicket(overrides: Partial<LinearTicket> = {}): LinearTicket {
  return {
    id: 'ticket-1',
    identifier: 'ENG-1',
    title: 'Add authentication',
    priority: 2,
    labels: [{ id: 'l1', name: 'feat' }],
    state: { id: 's1', name: 'Done', type: 'completed' },
    assignee: { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
    url: 'https://linear.app/issue/ENG-1',
    createdAt: '2024-06-01T00:00:00Z',
    updatedAt: '2024-06-15T00:00:00Z',
    ...overrides,
  }
}

const RELEASE_ROW: Record<string, unknown> = {
  id: 'rel-uuid-1',
  version: '1.2.0',
  branch: 'release/1.2.0',
  status: 'planning',
  linear_cycle_id: null,
  manifest: null,
  notes: null,
  freeze_at: null,
  released_at: null,
  created_at: NOW_ISO,
  updated_at: NOW_ISO,
}

function makePool(rowSets: unknown[][] = []): ReleasesPool & { query: ReturnType<typeof vi.fn> } {
  let call = 0
  return {
    query: vi.fn((_text: string, _values?: unknown[]) => {
      const rows = (rowSets[call++] ?? []) as Record<string, unknown>[]
      return Promise.resolve({ rows })
    }),
  }
}

function makeFetch(data: unknown, status = 200): FetchFn {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  })
}

// ---------------------------------------------------------------------------
// ManifestBuilder
// ---------------------------------------------------------------------------

describe('ManifestBuilder', () => {
  it('builds an empty manifest for no tickets', () => {
    const builder = new ManifestBuilder(() => NOW_ISO)
    const manifest = builder.build('1.0.0', [])
    expect(manifest.version).toBe('1.0.0')
    expect(manifest.entries).toHaveLength(0)
    expect(manifest.generatedAt).toBe(NOW_ISO)
  })

  it('maps ticket fields to manifest entries', () => {
    const builder = new ManifestBuilder(() => NOW_ISO)
    const ticket = makeTicket()
    const manifest = builder.build('1.2.0', [ticket])
    expect(manifest.entries).toHaveLength(1)
    const entry = manifest.entries[0]
    expect(entry.ticketId).toBe('ticket-1')
    expect(entry.identifier).toBe('ENG-1')
    expect(entry.title).toBe('Add authentication')
    expect(entry.labels).toEqual(['feat'])
    expect(entry.priority).toBe(2)
    expect(entry.assigneeId).toBe('user-1')
    expect(entry.url).toBe('https://linear.app/issue/ENG-1')
  })

  it('sorts tickets by ascending priority', () => {
    const builder = new ManifestBuilder(() => NOW_ISO)
    const t1 = makeTicket({ id: 't1', identifier: 'ENG-1', priority: 3 })
    const t2 = makeTicket({ id: 't2', identifier: 'ENG-2', priority: 1 })
    const t3 = makeTicket({ id: 't3', identifier: 'ENG-3', priority: 2 })
    const manifest = builder.build('1.0.0', [t1, t2, t3])
    expect(manifest.entries.map((e) => e.identifier)).toEqual(['ENG-2', 'ENG-3', 'ENG-1'])
  })

  it('attaches dispatchId and mergedAt from the dispatch map', () => {
    const builder = new ManifestBuilder(() => NOW_ISO)
    const ticket = makeTicket()
    const dispatchMap = new Map([
      ['ticket-1', { dispatchId: 'dispatch-abc', mergedAt: '2024-07-01T10:00:00Z' }],
    ])
    const manifest = builder.build('1.0.0', [ticket], dispatchMap)
    expect(manifest.entries[0].dispatchId).toBe('dispatch-abc')
    expect(manifest.entries[0].mergedAt).toBe('2024-07-01T10:00:00Z')
  })

  it('leaves dispatchId/mergedAt undefined when not in the map', () => {
    const builder = new ManifestBuilder(() => NOW_ISO)
    const manifest = builder.build('1.0.0', [makeTicket()])
    expect(manifest.entries[0].dispatchId).toBeUndefined()
    expect(manifest.entries[0].mergedAt).toBeUndefined()
  })

  it('handles tickets with no labels', () => {
    const builder = new ManifestBuilder(() => NOW_ISO)
    const ticket = makeTicket({ labels: [] })
    const manifest = builder.build('1.0.0', [ticket])
    expect(manifest.entries[0].labels).toEqual([])
  })

  it('handles tickets with no assignee', () => {
    const builder = new ManifestBuilder(() => NOW_ISO)
    const ticket = makeTicket({ assignee: undefined })
    const manifest = builder.build('1.0.0', [ticket])
    expect(manifest.entries[0].assigneeId).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// ReleaseNotesGenerator
// ---------------------------------------------------------------------------

describe('ReleaseNotesGenerator', () => {
  const FIXED_MANIFEST: ReleaseManifest = {
    version: '2.0.0',
    generatedAt: NOW_ISO,
    entries: [
      {
        ticketId: 't1',
        identifier: 'ENG-10',
        title: 'New login page',
        labels: ['feat'],
        priority: 1,
        url: 'https://linear.app/issue/ENG-10',
      },
      {
        ticketId: 't2',
        identifier: 'ENG-11',
        title: 'Fix password reset',
        labels: ['fix'],
        priority: 2,
        url: 'https://linear.app/issue/ENG-11',
      },
      {
        ticketId: 't3',
        identifier: 'ENG-12',
        title: 'Update deps',
        labels: ['chore'],
        priority: 3,
      },
    ],
  }

  it('starts with the release version heading', () => {
    const gen = new ReleaseNotesGenerator()
    const notes = gen.generate(FIXED_MANIFEST)
    expect(notes).toMatch(/^# Release 2\.0\.0/)
  })

  it('contains section headings for each label group', () => {
    const gen = new ReleaseNotesGenerator()
    const notes = gen.generate(FIXED_MANIFEST)
    expect(notes).toContain('## Features')
    expect(notes).toContain('## Bug Fixes')
    expect(notes).toContain('## Maintenance')
  })

  it('lists ticket identifiers and titles', () => {
    const gen = new ReleaseNotesGenerator()
    const notes = gen.generate(FIXED_MANIFEST)
    expect(notes).toContain('**ENG-10**: New login page')
    expect(notes).toContain('**ENG-11**: Fix password reset')
    expect(notes).toContain('**ENG-12**: Update deps')
  })

  it('includes URL links by default', () => {
    const gen = new ReleaseNotesGenerator()
    const notes = gen.generate(FIXED_MANIFEST)
    expect(notes).toContain('[link](https://linear.app/issue/ENG-10)')
  })

  it('omits URLs when includeUrl is false', () => {
    const gen = new ReleaseNotesGenerator()
    const notes = gen.generate(FIXED_MANIFEST, { includeUrl: false })
    expect(notes).not.toContain('[link]')
  })

  it('appends a generatedAt footer', () => {
    const gen = new ReleaseNotesGenerator()
    const notes = gen.generate(FIXED_MANIFEST)
    expect(notes).toContain(`_Generated ${NOW_ISO}_`)
  })

  it('does not group when groupByLabel is false', () => {
    const gen = new ReleaseNotesGenerator()
    const notes = gen.generate(FIXED_MANIFEST, { groupByLabel: false })
    expect(notes).not.toContain('## Features')
    expect(notes).not.toContain('## Bug Fixes')
    expect(notes).toContain('**ENG-10**')
    expect(notes).toContain('**ENG-11**')
  })

  it('handles entries with no labels in the "other" group', () => {
    const gen = new ReleaseNotesGenerator()
    const manifest: ReleaseManifest = {
      version: '1.0.0',
      generatedAt: NOW_ISO,
      entries: [{ ticketId: 't9', identifier: 'ENG-9', title: 'Misc', labels: [], priority: 1 }],
    }
    const notes = gen.generate(manifest)
    expect(notes).toContain('## Other Changes')
    expect(notes).toContain('**ENG-9**: Misc')
  })

  it('includes assignee ids when includeAssignee is true', () => {
    const gen = new ReleaseNotesGenerator()
    const manifest: ReleaseManifest = {
      version: '1.0.0',
      generatedAt: NOW_ISO,
      entries: [
        {
          ticketId: 't1',
          identifier: 'ENG-1',
          title: 'Do thing',
          labels: ['feat'],
          priority: 1,
          assigneeId: 'user-42',
        },
      ],
    }
    const notes = gen.generate(manifest, { includeAssignee: true })
    expect(notes).toContain('_(user-42)_')
  })
})

// ---------------------------------------------------------------------------
// FreezeWindowManager
// ---------------------------------------------------------------------------

describe('FreezeWindowManager', () => {
  const BASE_RELEASE: Release = {
    id: 'r1',
    version: '1.0.0',
    branch: 'release/1.0.0',
    status: 'planning',
    createdAt: NOW,
    updatedAt: NOW,
  }

  it('returns frozen=false for an empty list', () => {
    const mgr = new FreezeWindowManager(() => NOW)
    expect(mgr.isFrozen([])).toEqual({ frozen: false })
  })

  it('returns frozen=false when all releases are in planning without a past freeze_at', () => {
    const mgr = new FreezeWindowManager(() => NOW)
    const future = new Date(NOW.getTime() + 86400_000)
    const release: Release = { ...BASE_RELEASE, freezeAt: future }
    expect(mgr.isFrozen([release])).toEqual({ frozen: false })
  })

  it('returns frozen=true when a release status is "frozen"', () => {
    const mgr = new FreezeWindowManager(() => NOW)
    const release: Release = { ...BASE_RELEASE, status: 'frozen' }
    const result = mgr.isFrozen([release])
    expect(result.frozen).toBe(true)
    expect(result.releaseId).toBe('r1')
    expect(result.version).toBe('1.0.0')
  })

  it('returns frozen=true when freeze_at has passed and status is planning', () => {
    const past = new Date(NOW.getTime() - 3600_000)
    const mgr = new FreezeWindowManager(() => NOW)
    const release: Release = { ...BASE_RELEASE, freezeAt: past }
    const result = mgr.isFrozen([release])
    expect(result.frozen).toBe(true)
    expect(result.freezeAt).toEqual(past)
  })

  it('does not freeze a released release whose freeze_at has passed', () => {
    const past = new Date(NOW.getTime() - 3600_000)
    const mgr = new FreezeWindowManager(() => NOW)
    const release: Release = { ...BASE_RELEASE, status: 'released', freezeAt: past }
    expect(mgr.isFrozen([release])).toEqual({ frozen: false })
  })

  it('shouldFreeze returns true when freeze_at <= now', () => {
    const mgr = new FreezeWindowManager(() => NOW)
    const past = new Date(NOW.getTime() - 1)
    const release: Release = { ...BASE_RELEASE, freezeAt: past }
    expect(mgr.shouldFreeze(release)).toBe(true)
  })

  it('shouldFreeze returns false when no freeze_at is set', () => {
    const mgr = new FreezeWindowManager(() => NOW)
    expect(mgr.shouldFreeze(BASE_RELEASE)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// ReleasePlanner
// ---------------------------------------------------------------------------

describe('ReleasePlanner', () => {
  const ISSUES_RESPONSE = {
    data: {
      team: {
        issues: {
          nodes: [
            {
              id: 'issue-1',
              identifier: 'ENG-1',
              title: 'Feature A',
              priority: 1,
              url: 'https://linear.app/issue/ENG-1',
              createdAt: NOW_ISO,
              updatedAt: NOW_ISO,
              state: { id: 's1', name: 'Done', type: 'completed' },
              labels: { nodes: [{ id: 'l1', name: 'feat' }] },
              assignee: null,
            },
          ],
        },
      },
    },
  }

  it('planFromTeamIssues fetches from Linear and builds a plan', async () => {
    const fetch = makeFetch(ISSUES_RESPONSE)
    const client = new LinearClient('api-key', fetch)
    const planner = new ReleasePlanner(client)
    const plan = await planner.planFromTeamIssues('team-1', '2.0.0', 'release/2.0.0')
    expect(plan.version).toBe('2.0.0')
    expect(plan.branch).toBe('release/2.0.0')
    expect(plan.tickets).toHaveLength(1)
    expect(plan.tickets[0].identifier).toBe('ENG-1')
    expect(plan.manifest.entries).toHaveLength(1)
    expect(plan.notes).toContain('# Release 2.0.0')
  })

  it('planFromTeamIssues passes linearCycleId into the plan', async () => {
    const fetch = makeFetch(ISSUES_RESPONSE)
    const client = new LinearClient('api-key', fetch)
    const planner = new ReleasePlanner(client)
    const plan = await planner.planFromTeamIssues('team-1', '2.0.0', 'release/2.0.0', {
      linearCycleId: 'cycle-42',
    })
    expect(plan.linearCycleId).toBe('cycle-42')
  })

  it('planFromTickets builds a plan without calling Linear', () => {
    const fetch = vi.fn()
    const client = new LinearClient('api-key', fetch as unknown as FetchFn)
    const planner = new ReleasePlanner(client)
    const tickets = [makeTicket()]
    const plan = planner.planFromTickets(tickets, '3.0.0', 'release/3.0.0', 'cycle-7')
    expect(plan.tickets).toHaveLength(1)
    expect(plan.linearCycleId).toBe('cycle-7')
    expect(fetch).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// ReleaseManager
// ---------------------------------------------------------------------------

describe('ReleaseManager.createRelease', () => {
  it('inserts a release and returns the row', async () => {
    const pool = makePool([[RELEASE_ROW]])
    const mgr = new ReleaseManager(pool)
    const release = await mgr.createRelease({ version: '1.2.0', branch: 'release/1.2.0' })
    expect(release.id).toBe('rel-uuid-1')
    expect(release.version).toBe('1.2.0')
    expect(release.status).toBe('planning')
  })

  it('sends INSERT INTO releases', async () => {
    const pool = makePool([[RELEASE_ROW]])
    const mgr = new ReleaseManager(pool)
    await mgr.createRelease({ version: '1.2.0', branch: 'release/1.2.0' })
    const [sql] = pool.query.mock.calls[0] as [string]
    expect(sql).toContain('INSERT INTO releases')
    expect(sql).toContain('RETURNING *')
  })

  it('passes version, branch, cycleId, freezeAt as params', async () => {
    const freezeAt = new Date('2024-08-01T00:00:00Z')
    const pool = makePool([[RELEASE_ROW]])
    const mgr = new ReleaseManager(pool)
    await mgr.createRelease({
      version: '1.2.0',
      branch: 'release/1.2.0',
      linearCycleId: 'cycle-5',
      freezeAt,
    })
    const [, values] = pool.query.mock.calls[0] as [string, unknown[]]
    expect(values[0]).toBe('1.2.0')
    expect(values[1]).toBe('release/1.2.0')
    expect(values[2]).toBe('cycle-5')
    expect(values[3]).toEqual(freezeAt)
  })

  it('passes null for optional fields when omitted', async () => {
    const pool = makePool([[RELEASE_ROW]])
    const mgr = new ReleaseManager(pool)
    await mgr.createRelease({ version: '1.2.0', branch: 'release/1.2.0' })
    const [, values] = pool.query.mock.calls[0] as [string, unknown[]]
    expect(values[2]).toBeNull()
    expect(values[3]).toBeNull()
  })
})

describe('ReleaseManager.getRelease', () => {
  it('returns a Release when found', async () => {
    const pool = makePool([[RELEASE_ROW]])
    const mgr = new ReleaseManager(pool)
    const release = await mgr.getRelease('rel-uuid-1')
    expect(release).not.toBeNull()
    expect(release!.id).toBe('rel-uuid-1')
  })

  it('returns null when not found', async () => {
    const pool = makePool([[]])
    const mgr = new ReleaseManager(pool)
    const release = await mgr.getRelease('no-such-id')
    expect(release).toBeNull()
  })
})

describe('ReleaseManager.getByVersion', () => {
  it('returns a Release by version', async () => {
    const pool = makePool([[RELEASE_ROW]])
    const mgr = new ReleaseManager(pool)
    const release = await mgr.getByVersion('1.2.0')
    expect(release!.version).toBe('1.2.0')
  })
})

describe('ReleaseManager.listReleases', () => {
  it('returns all releases when no status filter', async () => {
    const pool = makePool([[RELEASE_ROW, { ...RELEASE_ROW, id: 'rel-2', version: '1.1.0' }]])
    const mgr = new ReleaseManager(pool)
    const releases = await mgr.listReleases()
    expect(releases).toHaveLength(2)
  })

  it('filters by status when provided', async () => {
    const pool = makePool([[RELEASE_ROW]])
    const mgr = new ReleaseManager(pool)
    await mgr.listReleases('planning')
    const [sql, values] = pool.query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('WHERE status = $1')
    expect(values[0]).toBe('planning')
  })
})

describe('ReleaseManager.updateRelease', () => {
  it('builds a SET clause with only provided fields', async () => {
    const updated = { ...RELEASE_ROW, status: 'frozen' }
    const pool = makePool([[updated]])
    const mgr = new ReleaseManager(pool)
    await mgr.updateRelease('rel-uuid-1', { status: 'frozen' })
    const [sql, values] = pool.query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('UPDATE releases')
    expect(sql).toContain('RETURNING *')
    expect(values).toContain('frozen')
    expect(values[values.length - 1]).toBe('rel-uuid-1')
  })

  it('stringifies manifest as JSON', async () => {
    const manifest: ReleaseManifest = { version: '1.0.0', entries: [], generatedAt: NOW_ISO }
    const pool = makePool([[RELEASE_ROW]])
    const mgr = new ReleaseManager(pool)
    await mgr.updateRelease('rel-uuid-1', { manifest })
    const [, values] = pool.query.mock.calls[0] as [string, unknown[]]
    expect(values[0]).toBe(JSON.stringify(manifest))
  })
})

describe('ReleaseManager.buildManifest', () => {
  it('delegates to ManifestBuilder', () => {
    const pool = makePool()
    const mgr = new ReleaseManager(pool)
    const ticket = makeTicket()
    const manifest = mgr.buildManifest('1.0.0', [ticket])
    expect(manifest.version).toBe('1.0.0')
    expect(manifest.entries).toHaveLength(1)
  })
})

describe('ReleaseManager.generateNotes', () => {
  it('delegates to ReleaseNotesGenerator', () => {
    const pool = makePool()
    const mgr = new ReleaseManager(pool)
    const manifest: ReleaseManifest = {
      version: '1.0.0',
      generatedAt: NOW_ISO,
      entries: [],
    }
    const notes = mgr.generateNotes(manifest)
    expect(notes).toContain('# Release 1.0.0')
  })
})

describe('ReleaseManager.attachManifest', () => {
  it('fetches the release, builds a manifest, and updates the release', async () => {
    const pool = makePool([[RELEASE_ROW], [RELEASE_ROW]])
    const mgr = new ReleaseManager(pool)
    const tickets = [makeTicket()]
    await mgr.attachManifest('rel-uuid-1', tickets)
    // First query: getRelease; second: updateRelease
    expect(pool.query).toHaveBeenCalledTimes(2)
    const [updateSql, updateVals] = pool.query.mock.calls[1] as [string, unknown[]]
    expect(updateSql).toContain('UPDATE releases')
    // manifest should be serialised JSON
    expect(typeof updateVals[0]).toBe('string')
    const manifest = JSON.parse(updateVals[0] as string) as ReleaseManifest
    expect(manifest.version).toBe('1.2.0')
    expect(manifest.entries).toHaveLength(1)
    // notes should also be present
    expect(typeof updateVals[1]).toBe('string')
    expect((updateVals[1] as string)).toContain('# Release 1.2.0')
  })

  it('throws when the release is not found', async () => {
    const pool = makePool([[]])
    const mgr = new ReleaseManager(pool)
    await expect(mgr.attachManifest('bad-id', [])).rejects.toThrow('Release bad-id not found')
  })
})

describe('ReleaseManager.setFreezeWindow', () => {
  it('calls updateRelease with the freeze_at date', async () => {
    const freezeAt = new Date('2024-09-01T00:00:00Z')
    const pool = makePool([[RELEASE_ROW]])
    const mgr = new ReleaseManager(pool)
    await mgr.setFreezeWindow('rel-uuid-1', freezeAt)
    const [, values] = pool.query.mock.calls[0] as [string, unknown[]]
    expect(values).toContain(freezeAt)
  })
})

describe('ReleaseManager.checkFreeze', () => {
  it('returns frozen=false when no releases', async () => {
    const pool = makePool([[]])
    const mgr = new ReleaseManager(pool)
    const result = await mgr.checkFreeze()
    expect(result.frozen).toBe(false)
  })

  it('returns frozen=true when a release is frozen', async () => {
    const frozenRow = { ...RELEASE_ROW, status: 'frozen' }
    const pool = makePool([[frozenRow]])
    const mgr = new ReleaseManager(pool)
    const result = await mgr.checkFreeze()
    expect(result.frozen).toBe(true)
    expect(result.version).toBe('1.2.0')
  })
})

describe('ReleaseManager.freeze', () => {
  it('updates status to frozen', async () => {
    const pool = makePool([[{ ...RELEASE_ROW, status: 'frozen' }]])
    const mgr = new ReleaseManager(pool)
    const release = await mgr.freeze('rel-uuid-1')
    expect(release.status).toBe('frozen')
  })
})

describe('ReleaseManager.markReleased', () => {
  it('updates status to released', async () => {
    const releasedRow = { ...RELEASE_ROW, status: 'released', released_at: NOW_ISO }
    const pool = makePool([[releasedRow]])
    const mgr = new ReleaseManager(pool)
    const release = await mgr.markReleased('rel-uuid-1')
    expect(release.status).toBe('released')
    expect(release.releasedAt).toEqual(NOW)
  })
})

describe('ReleaseManager.planFromLinear', () => {
  it('throws when no LinearClient was provided', async () => {
    const pool = makePool()
    const mgr = new ReleaseManager(pool)
    await expect(mgr.planFromLinear('team-1', '1.0.0', 'release/1.0.0')).rejects.toThrow(
      'LinearClient required',
    )
  })

  it('returns a plan when LinearClient is provided', async () => {
    const issuesResponse = {
      data: {
        team: {
          issues: {
            nodes: [
              {
                id: 'i1',
                identifier: 'ENG-1',
                title: 'Thing',
                priority: 1,
                createdAt: NOW_ISO,
                updatedAt: NOW_ISO,
                state: { id: 's1', name: 'Done', type: 'completed' },
                labels: { nodes: [] },
                assignee: null,
              },
            ],
          },
        },
      },
    }
    const fetch = makeFetch(issuesResponse)
    const client = new LinearClient('api-key', fetch)
    const pool = makePool()
    const mgr = new ReleaseManager(pool, client)
    const plan = await mgr.planFromLinear('team-1', '1.0.0', 'release/1.0.0')
    expect(plan.version).toBe('1.0.0')
    expect(plan.tickets).toHaveLength(1)
  })
})

describe('createReleaseManager', () => {
  it('returns a ReleaseManager instance', () => {
    const pool = makePool()
    const mgr = createReleaseManager(pool)
    expect(mgr).toBeInstanceOf(ReleaseManager)
  })
})

describe('rowToRelease date handling', () => {
  it('parses freeze_at and released_at as Date objects', async () => {
    const row = {
      ...RELEASE_ROW,
      freeze_at: '2024-08-01T00:00:00Z',
      released_at: '2024-09-01T00:00:00Z',
      status: 'released',
    }
    const pool = makePool([[row]])
    const mgr = new ReleaseManager(pool)
    const release = await mgr.getRelease('rel-uuid-1')
    expect(release!.freezeAt).toEqual(new Date('2024-08-01T00:00:00Z'))
    expect(release!.releasedAt).toEqual(new Date('2024-09-01T00:00:00Z'))
  })

  it('leaves freezeAt/releasedAt undefined when DB columns are null', async () => {
    const pool = makePool([[RELEASE_ROW]])
    const mgr = new ReleaseManager(pool)
    const release = await mgr.getRelease('rel-uuid-1')
    expect(release!.freezeAt).toBeUndefined()
    expect(release!.releasedAt).toBeUndefined()
  })
})
