import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ZodError } from 'zod'
import * as commands from '../../src/agent-iface/commands'
import { createHotspotLeaseManager } from '../../src/hotspots'
import type { ProvenancePool } from '../../src/provenance'
import type { ReleasesPool, ReleaseLinearClient } from '../../src/releases'
import type { LinearTicket } from '../../src/integrations/linear/types'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePool(rowSets: unknown[][] = []): { query: ReturnType<typeof vi.fn> } {
  let call = 0
  return {
    query: vi.fn(() => Promise.resolve({ rows: rowSets[call++] ?? [] })),
  }
}

const RELEASE_ROW = {
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
  state: { id: 'state-1', name: 'Done', type: 'completed' },
  priority: 2,
  labels: [{ id: 'l1', name: 'feat' }],
  url: 'https://linear.app/issue/ENG-1',
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

describe('planSchedule', () => {
  it('schedules non-overlapping tickets in parallel', () => {
    const plan = commands.planSchedule({
      tickets: [
        { ticketId: 'ENG-1', title: 'Update release notes', expectedFiles: ['src/release/notes.ts'] },
        { ticketId: 'ENG-2', title: 'Fix scheduler bug', expectedFiles: ['src/scheduler/index.ts'] },
      ],
    })

    expect(plan.ticketCount).toBe(2)
    expect(plan.waves[0]).toHaveLength(2)
    expect(plan.groups.every(g => g.decision === 'parallel')).toBe(true)
  })

  it('merges tickets that touch the same files into one group', () => {
    const plan = commands.planSchedule({
      tickets: [
        { ticketId: 'ENG-1', title: 'A', expectedFiles: ['src/db/schema.ts'] },
        { ticketId: 'ENG-2', title: 'B', expectedFiles: ['src/db/schema.ts'] },
      ],
    })

    expect(plan.mergeCount).toBe(1)
    expect(plan.groups[0].tickets.sort()).toEqual(['ENG-1', 'ENG-2'])
  })

  it('rejects an empty ticket list', () => {
    expect(() => commands.planSchedule({ tickets: [] })).toThrow(ZodError)
  })
})

// ---------------------------------------------------------------------------
// Hotspots
// ---------------------------------------------------------------------------

describe('hotspot commands', () => {
  let manager: ReturnType<typeof createHotspotLeaseManager>

  beforeEach(() => {
    manager = createHotspotLeaseManager()
  })

  it('registers a hotspot and reports a touching file', () => {
    const result = commands.registerHotspot(
      { name: 'db-migrations', patterns: ['src/db/migrations/'], reason: 'schema changes are hard to redo' },
      manager,
    )
    expect(result.registered).toBe(true)

    const check = commands.checkHotspot({ files: ['src/db/migrations/002_x.sql'] }, manager)
    expect(check.touchesHotspot).toBe(true)
    expect(check.matches[0].hotspot.name).toBe('db-migrations')
  })

  it('blocks a second acquire while a lease is held, and releases by id', () => {
    commands.registerHotspot({ name: 'contract', patterns: ['src/shared/contract.ts'], reason: 'shared interface' }, manager)

    const first = commands.acquireLease({ holderId: 'agent-1', files: ['src/shared/contract.ts'] }, manager)
    expect(first.status).toBe('granted')

    const second = commands.acquireLease({ holderId: 'agent-2', files: ['src/shared/contract.ts'] }, manager)
    expect(second.status).toBe('blocked')

    const released = commands.releaseLease({ leaseId: first.lease!.id }, manager)
    expect(released.released).toBe(true)

    const third = commands.acquireLease({ holderId: 'agent-2', files: ['src/shared/contract.ts'] }, manager)
    expect(third.status).toBe('granted')
  })

  it('grants a lease for files outside any hotspot as not-required', () => {
    const result = commands.acquireLease({ holderId: 'agent-1', files: ['src/index.ts'] }, manager)
    expect(result.status).toBe('not-required')
  })

  it('releaseLeaseByHolder releases every lease for that holder', () => {
    commands.registerHotspot({ name: 'a', patterns: ['a.ts'], reason: 'r' }, manager)
    commands.registerHotspot({ name: 'b', patterns: ['b.ts'], reason: 'r' }, manager)
    commands.acquireLease({ holderId: 'agent-1', files: ['a.ts'] }, manager)
    commands.acquireLease({ holderId: 'agent-1', files: ['b.ts'] }, manager)

    expect(commands.listActiveLeases(manager)).toHaveLength(2)
    const { count } = commands.releaseLeaseByHolder({ holderId: 'agent-1' }, manager)
    expect(count).toBe(2)
    expect(commands.listActiveLeases(manager)).toHaveLength(0)
  })

  it('shares state via the process-wide manager by default', () => {
    commands.resetHotspotManager()
    commands.registerHotspot({ name: 'shared', patterns: ['x.ts'], reason: 'r' })
    const check = commands.checkHotspot({ files: ['x.ts'] })
    expect(check.touchesHotspot).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

describe('runGatePipeline', () => {
  it('passes a low-risk docs change with green CI and no QA/HITL configured', async () => {
    const result = await commands.runGatePipeline({
      dispatchId: 'd1',
      ticketId: 'ENG-1',
      branch: 'docs/ENG-1/readme',
      domains: ['docs'],
      expectedFiles: ['README.md'],
      actualFiles: ['README.md'],
      ciStatus: 'success',
    })
    expect(result.passed).toBe(true)
  })

  it('blocks a high-risk change when the human reviewer rejects it', async () => {
    const result = await commands.runGatePipeline({
      dispatchId: 'd2',
      ticketId: 'ENG-2',
      branch: 'fix/ENG-2/migration',
      domains: ['db'],
      expectedFiles: ['src/db/migrations/003.sql'],
      actualFiles: ['src/db/migrations/003.sql'],
      ciStatus: 'success',
      qaResult: { passed: true },
      approved: false,
    })
    expect(result.passed).toBe(false)
    expect(result.blockedAt).toBe('hitl')
  })

  it('blocks on red CI before QA or HITL run', async () => {
    const result = await commands.runGatePipeline({
      dispatchId: 'd3',
      ticketId: 'ENG-3',
      branch: 'fix/ENG-3/x',
      domains: ['db'],
      expectedFiles: ['src/db/migrations/004.sql'],
      actualFiles: ['src/db/migrations/004.sql'],
      ciStatus: 'failure',
      approved: true,
    })
    expect(result.passed).toBe(false)
    expect(result.blockedAt).toBe('ci')
  })
})

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

describe('provenance commands', () => {
  it('records an event and returns its id', async () => {
    const pool = makePool([[{ id: 'audit-1' }]]) as unknown as ProvenancePool
    const result = await commands.recordProvenance(
      { eventType: 'dispatch.created', actor: 'harbormaster', ticketId: 'ENG-1' },
      pool,
    )
    expect(result).toEqual({ id: 'audit-1' })
  })

  it('queries the audit log filtered by ticket', async () => {
    const row = {
      id: 'audit-1',
      event_type: 'gate.hitl',
      payload: {},
      ticket_id: 'ENG-1',
      agent_id: null,
      actor: 'harbormaster',
      created_at: new Date('2024-06-01T00:00:00Z'),
    }
    const pool = makePool([[row]]) as unknown as ProvenancePool
    const events = await commands.queryProvenance({ ticketId: 'ENG-1' }, pool)
    expect(events).toHaveLength(1)
    expect(events[0].eventType).toBe('gate.hitl')
  })
})

// ---------------------------------------------------------------------------
// Releases
// ---------------------------------------------------------------------------

describe('release commands', () => {
  it('creates a release', async () => {
    const pool = makePool([[RELEASE_ROW]]) as unknown as ReleasesPool
    const release = await commands.createRelease({ version: '1.2.0', branch: 'release/1.2.0' }, pool)
    expect(release.version).toBe('1.2.0')
    expect(release.status).toBe('planning')
  })

  it('lists releases', async () => {
    const pool = makePool([[RELEASE_ROW]]) as unknown as ReleasesPool
    const releases = await commands.listReleases({}, pool)
    expect(releases).toHaveLength(1)
  })

  it('builds a manifest from an injected Linear client', async () => {
    const pool = makePool([[RELEASE_ROW]]) as unknown as ReleasesPool
    const linearClient: ReleaseLinearClient = { listTeamIssues: vi.fn().mockResolvedValue([TICKET]) }

    const manifest = await commands.buildReleaseManifest(
      { releaseId: 'release-uuid-1', teamId: 'team-1' },
      { pool, linearClient },
    )

    expect(manifest.tickets).toHaveLength(1)
    expect(manifest.tickets[0].identifier).toBe('ENG-1')
  })

  it('renders release notes from a manifest without touching the database', () => {
    const notes = commands.generateReleaseNotes({
      manifest: {
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
            url: 'https://linear.app/issue/ENG-1',
          },
        ],
        summary: { total: 1, byStatus: { Done: 1 }, byPriority: { 2: 1 } },
      },
    })

    expect(notes).toContain('# Release 1.2.0')
    expect(notes).toContain('ENG-1')
  })
})
