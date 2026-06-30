import { describe, it, expect } from 'vitest'
import { computeTransitiveImpact, analyseOverlap } from '../../src/impact/estimator'
import type { DependencyGraph, ImpactSurface } from '../../src/impact/types'

// ─── helpers ────────────────────────────────────────────────────────────────

function makeGraph(edges: Record<string, string[]>): DependencyGraph {
  const graph: DependencyGraph = new Map()
  for (const [file, imports] of Object.entries(edges)) {
    if (!graph.has(file)) graph.set(file, { path: file, imports, importedBy: [] })
    else graph.get(file)!.imports = imports
  }
  // populate importedBy
  for (const [file, imports] of Object.entries(edges)) {
    for (const dep of imports) {
      if (!graph.has(dep)) graph.set(dep, { path: dep, imports: [], importedBy: [] })
      const depNode = graph.get(dep)!
      if (!depNode.importedBy.includes(file)) depNode.importedBy.push(file)
    }
  }
  return graph
}

function surface(ticketId: string, direct: string[], transitive: string[]): ImpactSurface {
  return { ticketId, directFiles: direct, transitiveFiles: transitive }
}

// ─── computeTransitiveImpact ────────────────────────────────────────────────

describe('computeTransitiveImpact', () => {
  it('returns only direct files when nothing imports them', () => {
    const graph = makeGraph({ 'a.ts': [], 'b.ts': [] })
    const result = computeTransitiveImpact('T1', ['a.ts'], graph)
    expect(result.directFiles).toEqual(['a.ts'])
    expect(result.transitiveFiles).toContain('a.ts')
    expect(result.transitiveFiles).not.toContain('b.ts')
  })

  it('includes direct importers of a changed file', () => {
    // feature.ts imports utils.ts; changing utils.ts impacts feature.ts too
    const graph = makeGraph({ 'feature.ts': ['utils.ts'] })
    const result = computeTransitiveImpact('T1', ['utils.ts'], graph)
    expect(result.transitiveFiles).toContain('utils.ts')
    expect(result.transitiveFiles).toContain('feature.ts')
  })

  it('walks multiple levels of importedBy transitively', () => {
    // c → b → a; changing a should surface b and c
    const graph = makeGraph({ 'b.ts': ['a.ts'], 'c.ts': ['b.ts'] })
    const result = computeTransitiveImpact('T1', ['a.ts'], graph)
    expect(result.transitiveFiles).toContain('a.ts')
    expect(result.transitiveFiles).toContain('b.ts')
    expect(result.transitiveFiles).toContain('c.ts')
  })

  it('handles diamond dependency without duplicates', () => {
    // d imports b and c; both import a
    const graph = makeGraph({
      'b.ts': ['a.ts'],
      'c.ts': ['a.ts'],
      'd.ts': ['b.ts', 'c.ts'],
    })
    const result = computeTransitiveImpact('T1', ['a.ts'], graph)
    const unique = new Set(result.transitiveFiles)
    expect(unique.size).toBe(result.transitiveFiles.length) // no duplicates
    expect(unique.has('a.ts')).toBe(true)
    expect(unique.has('b.ts')).toBe(true)
    expect(unique.has('c.ts')).toBe(true)
    expect(unique.has('d.ts')).toBe(true)
  })

  it('handles multiple direct files', () => {
    const graph = makeGraph({
      'consumer.ts': ['lib/a.ts'],
      'lib/a.ts': [],
      'lib/b.ts': [],
    })
    const result = computeTransitiveImpact('T1', ['lib/a.ts', 'lib/b.ts'], graph)
    expect(result.transitiveFiles).toContain('lib/a.ts')
    expect(result.transitiveFiles).toContain('lib/b.ts')
    expect(result.transitiveFiles).toContain('consumer.ts')
  })

  it('handles files not in the graph gracefully', () => {
    const graph: DependencyGraph = new Map()
    const result = computeTransitiveImpact('T1', ['missing.ts'], graph)
    expect(result.transitiveFiles).toContain('missing.ts')
    expect(result.transitiveFiles).toHaveLength(1)
  })

  it('sets the correct ticketId on the result', () => {
    const graph = makeGraph({})
    const result = computeTransitiveImpact('TICKET-42', [], graph)
    expect(result.ticketId).toBe('TICKET-42')
  })

  it('returns an empty surface for no direct files', () => {
    const graph = makeGraph({ 'a.ts': [] })
    const result = computeTransitiveImpact('T1', [], graph)
    expect(result.transitiveFiles).toHaveLength(0)
  })
})

// ─── analyseOverlap ──────────────────────────────────────────────────────────

describe('analyseOverlap', () => {
  it('returns zero ratio when surfaces share no files', () => {
    const a = surface('T1', ['a.ts'], ['a.ts'])
    const b = surface('T2', ['b.ts'], ['b.ts'])
    const result = analyseOverlap(a, b)
    expect(result.overlapRatio).toBe(0)
    expect(result.overlappingFiles).toHaveLength(0)
  })

  it('returns ratio 1 when one surface is a subset of the other', () => {
    const a = surface('T1', ['shared.ts'], ['shared.ts'])
    const b = surface('T2', ['shared.ts', 'other.ts'], ['shared.ts', 'other.ts'])
    const result = analyseOverlap(a, b)
    // smaller surface = a (size 1), overlap = 1 → ratio = 1
    expect(result.overlapRatio).toBe(1)
    expect(result.overlappingFiles).toEqual(['shared.ts'])
  })

  it('measures overlap ratio against the smaller surface', () => {
    const a = surface('T1', [], ['x.ts', 'y.ts'])           // size 2
    const b = surface('T2', [], ['x.ts', 'y.ts', 'z.ts'])  // size 3
    const result = analyseOverlap(a, b)
    // overlap = 2, smaller = 2 → ratio = 1
    expect(result.overlapRatio).toBe(1)
  })

  it('computes partial overlap correctly', () => {
    const a = surface('T1', [], ['a.ts', 'b.ts', 'c.ts', 'd.ts'])
    const b = surface('T2', [], ['b.ts', 'c.ts'])
    const result = analyseOverlap(a, b)
    // smaller = 2 (b), overlapping = 2 → ratio = 1
    expect(result.overlapRatio).toBe(1)
    expect(result.overlappingFiles).toContain('b.ts')
    expect(result.overlappingFiles).toContain('c.ts')
  })

  it('handles empty surfaces without dividing by zero', () => {
    const a = surface('T1', [], [])
    const b = surface('T2', [], [])
    const result = analyseOverlap(a, b)
    expect(result.overlapRatio).toBe(0)
    expect(result.overlappingFiles).toHaveLength(0)
  })

  it('records correct ticket IDs in the result', () => {
    const a = surface('TICKET-1', [], ['a.ts'])
    const b = surface('TICKET-2', [], ['b.ts'])
    const result = analyseOverlap(a, b)
    expect(result.ticketA).toBe('TICKET-1')
    expect(result.ticketB).toBe('TICKET-2')
  })

  it('identifies all overlapping files', () => {
    const a = surface('T1', [], ['x.ts', 'y.ts', 'z.ts'])
    const b = surface('T2', [], ['y.ts', 'z.ts', 'w.ts'])
    const result = analyseOverlap(a, b)
    expect(result.overlappingFiles.sort()).toEqual(['y.ts', 'z.ts'])
  })
})
