import type { DependencyGraph, ImpactSurface, OverlapAnalysis } from './types'

/**
 * Computes the transitive impact surface for a ticket.
 *
 * Starting from the set of files a ticket directly modifies, walks the
 * dependency graph in the reverse direction (importedBy) to find every
 * file that *uses* the changed files, directly or indirectly.  These
 * upstream files could break if the API or behaviour of a direct file
 * changes, so they are part of the impact surface even if untouched.
 *
 * Example: if `utils.ts` is modified and `feature.ts` imports `utils.ts`,
 * both appear in the transitive surface.
 */
export function computeTransitiveImpact(
  ticketId: string,
  directFiles: string[],
  graph: DependencyGraph,
): ImpactSurface {
  const visited = new Set<string>(directFiles)
  const queue = [...directFiles]

  while (queue.length > 0) {
    const file = queue.shift()!
    const node = graph.get(file)
    if (!node) continue
    for (const upstream of node.importedBy) {
      if (!visited.has(upstream)) {
        visited.add(upstream)
        queue.push(upstream)
      }
    }
  }

  return { ticketId, directFiles, transitiveFiles: [...visited] }
}

/**
 * Analyses the file-level overlap between two impact surfaces.
 *
 * The overlap ratio is the number of shared files divided by the size of
 * the *smaller* surface — so a small ticket touching a large shared module
 * will show a high ratio, even if the large ticket's surface is much bigger.
 * This prevents a wide-impact ticket from masking conflicts with narrower ones.
 */
export function analyseOverlap(a: ImpactSurface, b: ImpactSurface): OverlapAnalysis {
  const setA = new Set(a.transitiveFiles)
  const overlappingFiles = b.transitiveFiles.filter(f => setA.has(f))
  const smaller = Math.min(a.transitiveFiles.length, b.transitiveFiles.length)
  const overlapRatio = smaller === 0 ? 0 : overlappingFiles.length / smaller

  return { ticketA: a.ticketId, ticketB: b.ticketId, overlappingFiles, overlapRatio }
}
