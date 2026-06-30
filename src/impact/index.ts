import path from 'path'
import type { ImpactEstimateInput, ImpactSurface, DomainMap } from './types'
import { DEFAULT_DOMAIN_MAP } from './types'

export type { ImpactEstimateInput, ImpactSurface, DomainMap } from './types'
export { DEFAULT_DOMAIN_MAP } from './types'

/**
 * Derives an {@link ImpactSurface} (files/directories/domains touched) for a
 * ticket, used by the scheduler to detect overlap between tickets before
 * dispatch. Estimation prefers the most precise signal available and falls
 * back to progressively fuzzier ones, which is why the resulting surface
 * carries a confidence score alongside the data.
 */
export class ImpactEstimator {
  constructor(private readonly domainMap: DomainMap = DEFAULT_DOMAIN_MAP) {}

  /**
   * Estimate the impact surface for a ticket.
   *
   * Three confidence tiers, applied in priority order:
   * - 1.0 — `expectedFiles` was explicitly provided, so files/directories/domains
   *   are derived directly from those paths (most reliable).
   * - 0.6 — no explicit files, but labels are present; domains are inferred by
   *   matching label/title/description text against the domain map.
   * - 0.3 — no files or labels; domains are inferred from title/description
   *   keywords alone (least reliable signal).
   *
   * When files aren't known directly, the resulting `files` array contains
   * synthetic directory-glob stubs (see `filesFromDomains`) rather than real
   * paths, so downstream overlap checks fall back to domain/directory matching.
   */
  estimate(input: ImpactEstimateInput): ImpactSurface {
    const { ticketId, title, description, labels = [], expectedFiles } = input

    if (expectedFiles && expectedFiles.length > 0) {
      const domains = this.domainsFromFiles(expectedFiles)
      return {
        ticketId,
        files: expectedFiles,
        directories: deriveDirectories(expectedFiles),
        domains,
        confidence: 1.0,
      }
    }

    const domains = this.domainsFromText(title, description, labels)
    const files = this.filesFromDomains(domains)

    return {
      ticketId,
      files,
      directories: deriveDirectories(files),
      domains,
      confidence: labels.length > 0 ? 0.6 : 0.3,
    }
  }

  private domainsFromFiles(files: string[]): string[] {
    const domains = new Set<string>()
    for (const file of files) {
      const normalized = file.replace(/\\/g, '/')
      for (const [keyword, domain] of Object.entries(this.domainMap)) {
        if (normalized.includes(keyword)) {
          domains.add(domain)
        }
      }
      // Also add the top-level src directory segment as a domain
      const match = normalized.match(/^(?:src\/)?([^/]+)/)
      if (match) domains.add(match[1])
    }
    return [...domains]
  }

  private domainsFromText(
    title: string,
    description: string | undefined,
    labels: string[],
  ): string[] {
    const domains = new Set<string>()
    const text = [title, description ?? '', ...labels].join(' ').toLowerCase()
    for (const [keyword, domain] of Object.entries(this.domainMap)) {
      if (text.includes(keyword)) {
        domains.add(domain)
      }
    }
    return [...domains]
  }

  /** Map domains back to representative file glob paths for overlap purposes */
  private filesFromDomains(domains: string[]): string[] {
    return domains.map(d => `src/${d}/`)
  }
}

/**
 * Compute the Jaccard similarity (intersection size / union size) between two
 * sets of file/path strings. Returns 0 when both inputs are empty, treating
 * "nothing vs nothing" as no overlap rather than undefined/NaN.
 */
export function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0
  const setA = new Set(a)
  const setB = new Set(b)
  let intersection = 0
  for (const item of setA) {
    if (setB.has(item)) intersection++
  }
  const union = new Set([...setA, ...setB]).size
  return union === 0 ? 0 : intersection / union
}

/**
 * Compute an overlap score between two impact surfaces, used by the scheduler
 * to decide whether tickets should merge, sequence, or run in parallel.
 *
 * Picks the most precise comparison available, in order:
 * 1. File-level Jaccard, when both surfaces have concrete files (not just
 *    directory-glob stubs from domain inference).
 * 2. Directory containment, when one side's files fall under the other's
 *    known directories (catches overlap that file-level Jaccard would miss
 *    because the exact filenames differ).
 * 3. Domain-level Jaccard, as the final fallback when neither surface has
 *    concrete file data to compare.
 */
export function computeOverlap(a: ImpactSurface, b: ImpactSurface): number {
  // Prefer file-level Jaccard when files are concrete (not just domain stubs)
  const aHasConcreteFiles = a.files.some(f => !f.endsWith('/'))
  const bHasConcreteFiles = b.files.some(f => !f.endsWith('/'))

  if (aHasConcreteFiles && bHasConcreteFiles) {
    return jaccardSimilarity(a.files, b.files)
  }

  // Fall back to directory containment check
  const dirOverlap = directoryOverlap(a, b)
  if (dirOverlap > 0) return dirOverlap

  // Final fallback: domain Jaccard
  return jaccardSimilarity(a.domains, b.domains)
}

/**
 * Extract the unique parent directory of each file (via `path.dirname`),
 * normalizing Windows-style separators. Used to populate `ImpactSurface.directories`
 * so overlap checks can fall back to directory containment when exact files differ.
 */
export function deriveDirectories(files: string[]): string[] {
  const dirs = new Set<string>()
  for (const file of files) {
    const dir = path.dirname(file.replace(/\\/g, '/'))
    if (dir && dir !== '.') dirs.add(dir)
  }
  return [...dirs]
}

/** Check whether any file in A is under a directory in B or vice-versa */
function directoryOverlap(a: ImpactSurface, b: ImpactSurface): number {
  const aDirs = new Set(a.directories.map(d => (d.endsWith('/') ? d : d + '/')))
  const bDirs = new Set(b.directories.map(d => (d.endsWith('/') ? d : d + '/')))

  let aHits = 0
  for (const f of b.files) {
    for (const dir of aDirs) {
      if (f.startsWith(dir)) { aHits++; break }
    }
  }
  let bHits = 0
  for (const f of a.files) {
    for (const dir of bDirs) {
      if (f.startsWith(dir)) { bHits++; break }
    }
  }

  const total = a.files.length + b.files.length
  return total === 0 ? 0 : (aHits + bHits) / total
}
