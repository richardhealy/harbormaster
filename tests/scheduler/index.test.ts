import { describe, it, expect } from 'vitest'
import { Scheduler } from '../../src/scheduler'
import { deriveDirectories } from '../../src/impact'
import type { ImpactSurface } from '../../src/impact'
import type { SchedulerTicket } from '../../src/scheduler'

/** Helper: build a concrete-file impact surface */
const surface = (ticketId: string, files: string[]): ImpactSurface => ({
  ticketId,
  files,
  directories: deriveDirectories(files),
  domains: [],
  confidence: 1.0,
})

/** Helper: build a domain-only surface (no concrete files) */
const domainSurface = (ticketId: string, domains: string[]): ImpactSurface => ({
  ticketId,
  files: domains.map(d => `src/${d}/`),
  directories: [],
  domains,
  confidence: 0.6,
})

const ticket = (ticketId: string, priority = 0): SchedulerTicket => ({ ticketId, priority })

describe('Scheduler', () => {
  describe('empty and single-ticket cases', () => {
    it('returns an empty plan for zero tickets', () => {
      const sched = new Scheduler()
      const plan = sched.plan([], new Map())
      expect(plan.waves).toHaveLength(0)
      expect(plan.groups).toHaveLength(0)
      expect(plan.ticketCount).toBe(0)
    })

    it('returns a single sequential group for one ticket', () => {
      const sched = new Scheduler()
      const surfaces = new Map([['ENG-1', surface('ENG-1', ['src/release/branch.ts'])]])
      const plan = sched.plan([ticket('ENG-1')], surfaces)

      expect(plan.waves).toHaveLength(1)
      expect(plan.waves[0]).toHaveLength(1)
      expect(plan.groups[0].tickets).toEqual(['ENG-1'])
      expect(plan.ticketCount).toBe(1)
    })
  })

  describe('parallel scheduling', () => {
    it('places two non-overlapping tickets in the same wave', () => {
      const sched = new Scheduler()
      const surfaces = new Map([
        ['ENG-1', surface('ENG-1', ['src/release/branch.ts'])],
        ['ENG-2', surface('ENG-2', ['src/db/migrate.ts'])],
      ])
      const plan = sched.plan([ticket('ENG-1'), ticket('ENG-2')], surfaces)

      expect(plan.waves).toHaveLength(1)
      expect(plan.waves[0]).toHaveLength(2)
      expect(plan.groups.map(g => g.decision)).toContain('parallel')
    })

    it('three non-overlapping tickets all land in wave 0', () => {
      const sched = new Scheduler()
      const surfaces = new Map([
        ['T1', surface('T1', ['src/release/branch.ts'])],
        ['T2', surface('T2', ['src/db/migrate.ts'])],
        ['T3', surface('T3', ['src/integrations/linear/index.ts'])],
      ])
      const plan = sched.plan([ticket('T1'), ticket('T2'), ticket('T3')], surfaces)

      expect(plan.waves).toHaveLength(1)
      expect(plan.waves[0]).toHaveLength(3)
    })
  })

  describe('merge scheduling', () => {
    it('merges two tickets with full file overlap (Jaccard 1.0) into one group', () => {
      const sched = new Scheduler({ mergeThreshold: 0.5, sequenceThreshold: 0 })
      const files = ['src/release/branch.ts', 'src/release/tags.ts']
      const surfaces = new Map([
        ['ENG-1', surface('ENG-1', files)],
        ['ENG-2', surface('ENG-2', files)],
      ])
      const plan = sched.plan([ticket('ENG-1'), ticket('ENG-2')], surfaces)

      expect(plan.groups).toHaveLength(1)
      expect(plan.groups[0].decision).toBe('merge')
      expect(plan.groups[0].tickets).toContain('ENG-1')
      expect(plan.groups[0].tickets).toContain('ENG-2')
      expect(plan.mergeCount).toBe(1)
    })

    it('does NOT merge when overlap is below the threshold', () => {
      const sched = new Scheduler({ mergeThreshold: 0.8, sequenceThreshold: 0 })
      // overlap = 1/3 ≈ 0.33 < 0.8
      const surfaces = new Map([
        ['ENG-1', surface('ENG-1', ['src/release/branch.ts', 'src/release/tags.ts'])],
        ['ENG-2', surface('ENG-2', ['src/release/branch.ts', 'src/db/migrate.ts'])],
      ])
      const plan = sched.plan([ticket('ENG-1'), ticket('ENG-2')], surfaces)

      expect(plan.groups).toHaveLength(2)
      expect(plan.mergeCount).toBe(0)
    })

    it('records the overlap score on a merged group', () => {
      const sched = new Scheduler({ mergeThreshold: 0.5, sequenceThreshold: 0 })
      const files = ['src/release/branch.ts']
      const surfaces = new Map([
        ['ENG-1', surface('ENG-1', files)],
        ['ENG-2', surface('ENG-2', files)],
      ])
      const plan = sched.plan([ticket('ENG-1'), ticket('ENG-2')], surfaces)

      expect(plan.groups[0].overlapScore).toBe(1.0)
    })

    it('exposes combinedSurface on a merged group', () => {
      const sched = new Scheduler({ mergeThreshold: 0.5, sequenceThreshold: 0 })
      const surfaces = new Map([
        ['ENG-1', surface('ENG-1', ['src/release/branch.ts'])],
        ['ENG-2', surface('ENG-2', ['src/release/branch.ts', 'src/release/tags.ts'])],
      ])
      const plan = sched.plan([ticket('ENG-1'), ticket('ENG-2')], surfaces)

      const merged = plan.groups[0]
      expect(merged.combinedSurface?.files).toContain('src/release/branch.ts')
      expect(merged.combinedSurface?.files).toContain('src/release/tags.ts')
    })
  })

  describe('sequence scheduling', () => {
    it('sequences two overlapping tickets into separate waves', () => {
      // overlap = 1/3 > 0 (sequenceThreshold) but < 0.8 (mergeThreshold) → sequence
      const sched = new Scheduler({ mergeThreshold: 0.8, sequenceThreshold: 0 })
      const surfaces = new Map([
        ['ENG-1', surface('ENG-1', ['src/release/branch.ts', 'src/release/tags.ts'])],
        ['ENG-2', surface('ENG-2', ['src/release/branch.ts', 'src/db/migrate.ts'])],
      ])
      const plan = sched.plan([ticket('ENG-1'), ticket('ENG-2')], surfaces)

      expect(plan.waves).toHaveLength(2)
      const wave0Ids = plan.waves[0].map(g => g.tickets[0])
      const wave1Ids = plan.waves[1].map(g => g.tickets[0])
      // ENG-1 comes first (input order), ENG-2 waits
      expect(wave0Ids).toContain('ENG-1')
      expect(wave1Ids).toContain('ENG-2')
    })

    it('marks the waiting group with decision "sequence"', () => {
      const sched = new Scheduler({ mergeThreshold: 0.8, sequenceThreshold: 0 })
      const surfaces = new Map([
        ['ENG-1', surface('ENG-1', ['src/release/branch.ts', 'src/release/tags.ts'])],
        ['ENG-2', surface('ENG-2', ['src/release/branch.ts', 'src/db/migrate.ts'])],
      ])
      const plan = sched.plan([ticket('ENG-1'), ticket('ENG-2')], surfaces)

      const seqGroup = plan.groups.find(g => g.decision === 'sequence')
      expect(seqGroup).toBeDefined()
    })
  })

  describe('mixed plan', () => {
    it('produces merge + parallel + sequence in the correct waves', () => {
      /**
       * ENG-1 and ENG-2 each have 3 release files with 2 in common → Jaccard 2/4 = 0.5 → merge
       * ENG-3 touches db/migrate.ts only → 0 overlap → parallel
       * ENG-4 touches only branch.ts → Jaccard with ENG-1 = 1/3 < 0.5 → no merge, but > 0 → sequence
       *
       * Expected plan (mergeThreshold=0.5):
       *   wave 0: [ENG-1+ENG-2 (merged), ENG-3 (parallel)]
       *   wave 1: [ENG-4 (sequence after merged group)]
       */
      const sched = new Scheduler({ mergeThreshold: 0.5, sequenceThreshold: 0 })
      const surfaces = new Map([
        ['ENG-1', surface('ENG-1', ['src/release/branch.ts', 'src/release/tags.ts', 'src/release/semver.ts'])],
        ['ENG-2', surface('ENG-2', ['src/release/branch.ts', 'src/release/tags.ts', 'src/release/hotfix.ts'])],
        ['ENG-3', surface('ENG-3', ['src/db/migrate.ts'])],
        ['ENG-4', surface('ENG-4', ['src/release/branch.ts'])],
      ])
      const plan = sched.plan(
        [ticket('ENG-1'), ticket('ENG-2'), ticket('ENG-3'), ticket('ENG-4')],
        surfaces,
      )

      expect(plan.mergeCount).toBe(1)
      expect(plan.waves).toHaveLength(2)

      const wave0Tickets = plan.waves[0].flatMap(g => g.tickets)
      expect(wave0Tickets).toContain('ENG-1')
      expect(wave0Tickets).toContain('ENG-2')
      expect(wave0Tickets).toContain('ENG-3')

      const wave1Tickets = plan.waves[1].flatMap(g => g.tickets)
      expect(wave1Tickets).toContain('ENG-4')
    })
  })

  describe('priority ordering', () => {
    it('sorts higher-priority tickets before lower-priority ones', () => {
      const sched = new Scheduler({ mergeThreshold: 0.5, sequenceThreshold: 0 })
      // ENG-1 has priority 10 (low), ENG-2 has priority 1 (high)
      // Both go into wave 0 independently, but order within the wave follows priority sort
      const surfaces = new Map([
        ['ENG-1', surface('ENG-1', ['src/release/branch.ts'])],
        ['ENG-2', surface('ENG-2', ['src/db/migrate.ts'])],
      ])
      const plan = sched.plan([ticket('ENG-1', 10), ticket('ENG-2', 1)], surfaces)

      // ENG-2 (priority 1) should appear before ENG-1 (priority 10) in groups
      const groupIds = plan.groups.map(g => g.tickets[0])
      expect(groupIds.indexOf('ENG-2')).toBeLessThan(groupIds.indexOf('ENG-1'))
    })
  })

  describe('domain-only surfaces', () => {
    it('sequences tickets that share a domain', () => {
      const sched = new Scheduler({ mergeThreshold: 0.8, sequenceThreshold: 0 })
      const surfaces = new Map([
        ['ENG-1', domainSurface('ENG-1', ['release'])],
        ['ENG-2', domainSurface('ENG-2', ['release'])],
      ])
      const plan = sched.plan([ticket('ENG-1'), ticket('ENG-2')], surfaces)

      // domain overlap = 1.0 >= mergeThreshold 0.8 → merge
      expect(plan.mergeCount).toBe(1)
    })

    it('parallelises tickets with different domains', () => {
      const sched = new Scheduler({ mergeThreshold: 0.5, sequenceThreshold: 0 })
      const surfaces = new Map([
        ['ENG-1', domainSurface('ENG-1', ['release'])],
        ['ENG-2', domainSurface('ENG-2', ['db'])],
      ])
      const plan = sched.plan([ticket('ENG-1'), ticket('ENG-2')], surfaces)

      expect(plan.waves).toHaveLength(1)
      expect(plan.groups.some(g => g.decision === 'parallel')).toBe(true)
    })
  })

  describe('unknown surfaces', () => {
    it('treats a ticket with no surface as zero overlap (runs in parallel)', () => {
      const sched = new Scheduler()
      const surfaces = new Map([['ENG-1', surface('ENG-1', ['src/release/branch.ts'])]])
      // ENG-2 has no surface
      const plan = sched.plan([ticket('ENG-1'), ticket('ENG-2')], surfaces)

      expect(plan.waves).toHaveLength(1)
      expect(plan.groups).toHaveLength(2)
    })
  })
})
