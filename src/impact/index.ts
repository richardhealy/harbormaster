import path from 'path'
import type { ImpactEstimateInput, ImpactSurface, DomainMap } from './types'
import { DEFAULT_DOMAIN_MAP } from './types'

export type { ImpactEstimateInput, ImpactSurface, DomainMap } from './types'
export { DEFAULT_DOMAIN_MAP } from './types'

export class ImpactEstimator {
  constructor(private readonly domainMap: DomainMap = DEFAULT_DOMAIN_MAP) {}

  /**
   * Estimate the impact surface for a ticket.
   *
   * Confidence is 1.0 when `expectedFiles` are provided; 0.6 when derived
   * from labels; 0.3 when inferred from title/description keywords alone.
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

/** Compute the Jaccard similarity between two sets of file/path strings */
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
 * Compute overlap between two impact surfaces.
 * Uses file-level Jaccard when both surfaces have explicit files, otherwise
 * falls back to domain-level Jaccard.
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

/** Extract unique parent directories (depth-1 from project root) from a file list */
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
