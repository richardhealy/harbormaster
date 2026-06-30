import { describe, it, expect } from 'vitest'
import {
  ImpactEstimator,
  jaccardSimilarity,
  computeOverlap,
  deriveDirectories,
} from '../../src/impact'
import type { ImpactSurface } from '../../src/impact'

describe('ImpactEstimator', () => {
  const estimator = new ImpactEstimator()

  describe('estimate — explicit files', () => {
    it('uses expectedFiles directly and sets confidence 1.0', () => {
      const surface = estimator.estimate({
        ticketId: 'ENG-1',
        title: 'Update release branch logic',
        expectedFiles: ['src/release/branch.ts', 'src/release/tags.ts'],
      })

      expect(surface.ticketId).toBe('ENG-1')
      expect(surface.files).toEqual(['src/release/branch.ts', 'src/release/tags.ts'])
      expect(surface.confidence).toBe(1.0)
      expect(surface.directories).toContain('src/release')
    })

    it('derives directories from expectedFiles', () => {
      const surface = estimator.estimate({
        ticketId: 'ENG-2',
        title: 'Fix worktree paths',
        expectedFiles: [
          'src/integration/worktrees/index.ts',
          'src/integration/queue/types.ts',
        ],
      })

      expect(surface.directories).toContain('src/integration/worktrees')
      expect(surface.directories).toContain('src/integration/queue')
    })

    it('extracts domains from file paths', () => {
      const surface = estimator.estimate({
        ticketId: 'ENG-3',
        title: 'DB migration',
        expectedFiles: ['src/db/migrations/002_add_jobs.sql'],
      })

      expect(surface.domains).toContain('db')
    })
  })

  describe('estimate — label/keyword fallback', () => {
    it('maps labels to domains and sets confidence 0.6', () => {
      const surface = estimator.estimate({
        ticketId: 'ENG-4',
        title: 'Improve hotfix fan-out',
        labels: ['release'],
      })

      expect(surface.domains).toContain('release')
      expect(surface.confidence).toBe(0.6)
      expect(surface.files.length).toBeGreaterThan(0)
    })

    it('infers domain from title keywords at confidence 0.3', () => {
      const surface = estimator.estimate({
        ticketId: 'ENG-5',
        title: 'Scheduler impact estimation',
      })

      expect(surface.domains).toContain('scheduler')
      expect(surface.confidence).toBe(0.3)
    })

    it('handles unknown keywords gracefully', () => {
      const surface = estimator.estimate({
        ticketId: 'ENG-6',
        title: 'Add loading spinner to dashboard',
      })

      expect(surface.files).toEqual([])
      expect(surface.domains).toEqual([])
      expect(surface.confidence).toBe(0.3)
    })
  })
})

describe('jaccardSimilarity', () => {
  it('returns 1.0 for identical sets', () => {
    expect(jaccardSimilarity(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(1.0)
  })

  it('returns 0 for disjoint sets', () => {
    expect(jaccardSimilarity(['a', 'b'], ['c', 'd'])).toBe(0)
  })

  it('returns 0 for two empty sets', () => {
    expect(jaccardSimilarity([], [])).toBe(0)
  })

  it('computes partial overlap correctly', () => {
    // intersection = {b}, union = {a,b,c} → 1/3
    expect(jaccardSimilarity(['a', 'b'], ['b', 'c'])).toBeCloseTo(1 / 3)
  })

  it('ignores duplicates via Set', () => {
    // Effectively ['a', 'b'] vs ['b', 'c'] after dedup
    expect(jaccardSimilarity(['a', 'a', 'b'], ['b', 'c'])).toBeCloseTo(1 / 3)
  })
})

describe('computeOverlap', () => {
  const makeSurface = (ticketId: string, files: string[], domains: string[]): ImpactSurface => ({
    ticketId,
    files,
    directories: deriveDirectories(files),
    domains,
    confidence: 1.0,
  })

  it('uses file-level Jaccard when both surfaces have concrete files', () => {
    const a = makeSurface('T1', ['src/release/branch.ts', 'src/release/tags.ts'], ['release'])
    const b = makeSurface('T2', ['src/release/branch.ts', 'src/release/sync.ts'], ['release'])
    // intersection = {branch.ts}, union = 3 → 1/3
    expect(computeOverlap(a, b)).toBeCloseTo(1 / 3)
  })

  it('returns 1.0 for identical file lists', () => {
    const a = makeSurface('T1', ['src/release/branch.ts'], ['release'])
    const b = makeSurface('T2', ['src/release/branch.ts'], ['release'])
    expect(computeOverlap(a, b)).toBe(1.0)
  })

  it('returns 0 for completely disjoint file sets', () => {
    const a = makeSurface('T1', ['src/release/branch.ts'], ['release'])
    const b = makeSurface('T2', ['src/db/migrate.ts'], ['db'])
    expect(computeOverlap(a, b)).toBe(0)
  })

  it('falls back to domain Jaccard when no concrete files', () => {
    // Surfaces from label-based estimation use "src/<domain>/" paths
    const a = makeSurface('T1', ['src/release/'], ['release'])
    const b = makeSurface('T2', ['src/release/'], ['release'])
    // domain overlap = 1.0
    expect(computeOverlap(a, b)).toBe(1.0)
  })

  it('returns 0 for two surfaces with no files and no domains', () => {
    const a = makeSurface('T1', [], [])
    const b = makeSurface('T2', [], [])
    expect(computeOverlap(a, b)).toBe(0)
  })
})

describe('deriveDirectories', () => {
  it('extracts unique parent directories', () => {
    const dirs = deriveDirectories(['src/release/branch.ts', 'src/release/tags.ts'])
    expect(dirs).toEqual(['src/release'])
  })

  it('handles multiple directories', () => {
    const dirs = deriveDirectories(['src/release/branch.ts', 'src/db/migrate.ts'])
    expect(dirs).toContain('src/release')
    expect(dirs).toContain('src/db')
    expect(dirs).toHaveLength(2)
  })

  it('returns empty for empty input', () => {
    expect(deriveDirectories([])).toEqual([])
  })
})
