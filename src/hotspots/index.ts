import type { ClockFn, Hotspot, Lease, LeaseRequest, LeaseResult, HotspotCheckResult } from './types'

export type { ClockFn, Hotspot, Lease, LeaseRequest, LeaseResult, HotspotCheckResult } from './types'

let leaseCounter = 0

/**
 * Matches a single file path against a hotspot pattern.
 *
 * Rules (evaluated in order):
 * - Pattern ends with `/` → directory prefix: file must start with that prefix.
 * - Pattern contains no `*` → exact match only.
 * - Pattern contains `**` → cross-segment wildcard (any number of path segments).
 * - Pattern contains `*` → single-segment wildcard (no `/` in the matched portion).
 */
export function matchesPattern(filePath: string, pattern: string): boolean {
  if (pattern.endsWith('/')) {
    return filePath.startsWith(pattern)
  }

  if (!pattern.includes('*')) {
    return filePath === pattern
  }

  // Convert the glob pattern to a regex by walking it character by character.
  // `**/` (double-star + slash) → optional directory chain `(?:.*/)?`
  // `**`  (standalone)          → any path segments `.*`
  // `*`   (single-star)         → within-segment wildcard `[^/]*`
  const META = new Set(['.', '+', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\'])
  let reg = '^'
  let i = 0
  while (i < pattern.length) {
    const ch = pattern[i]
    if (ch === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') {
        reg += '(?:.*\\/)?'
        i += 3
      } else {
        reg += '.*'
        i += 2
      }
    } else if (ch === '*') {
      reg += '[^/]*'
      i++
    } else if (META.has(ch)) {
      reg += '\\' + ch
      i++
    } else {
      reg += ch
      i++
    }
  }
  reg += '$'

  return new RegExp(reg).test(filePath)
}

function getMatchedFiles(hotspot: Hotspot, files: string[]): string[] {
  return files.filter(f => hotspot.patterns.some(p => matchesPattern(f, p)))
}

/**
 * Manages advisory leases for hotspot paths — files or directories that are
 * too costly to revisit after a conflict (e.g. database migrations, shared API
 * contracts). Only one agent may hold a lease on a given hotspot at a time.
 *
 * The rest of the repository is always lock-free; only the explicitly declared
 * hotspot set requires a lease before work begins.
 */
export class HotspotLeaseManager {
  private readonly hotspots: Map<string, Hotspot> = new Map()
  private readonly leases: Map<string, Lease> = new Map()

  constructor(private readonly clock: ClockFn = () => new Date()) {}

  /** Register a hotspot. Replaces any existing entry with the same name. */
  register(hotspot: Hotspot): void {
    this.hotspots.set(hotspot.name, hotspot)
  }

  /** Returns all registered hotspots. */
  listHotspots(): Hotspot[] {
    return Array.from(this.hotspots.values())
  }

  /**
   * Checks whether the given files overlap any registered hotspot without
   * acquiring a lease. Safe to call at any time.
   */
  check(files: string[]): HotspotCheckResult {
    const matches: HotspotCheckResult['matches'] = []

    for (const hotspot of this.hotspots.values()) {
      const matched = getMatchedFiles(hotspot, files)
      if (matched.length > 0) {
        matches.push({ hotspot, matchedFiles: matched })
      }
    }

    return { touchesHotspot: matches.length > 0, matches }
  }

  /**
   * Attempts to acquire an advisory lease for the hotspot matched by the
   * given files.
   *
   * - `'not-required'` — no registered hotspot is touched; the change may
   *   proceed without any lease.
   * - `'blocked'` — another holder already holds the lease; the caller must
   *   wait and retry.
   * - `'granted'` — the lease was acquired; the caller must `release()` it
   *   when the work is complete (or when the TTL expires).
   *
   * When multiple hotspots are matched, the first one in registration order
   * that is already leased triggers a `'blocked'` result; if none are held the
   * lease is granted for the first matched hotspot.
   */
  acquire(request: LeaseRequest): LeaseResult {
    this.pruneExpired()

    const { holderId, files, ttlMs } = request
    const checkResult = this.check(files)

    if (!checkResult.touchesHotspot) {
      return { status: 'not-required', matchedFiles: [] }
    }

    // Check each matched hotspot in order — block on the first active lease found.
    for (const { hotspot, matchedFiles: matched } of checkResult.matches) {
      const existingLease = this.findActiveLease(hotspot.name)
      if (existingLease) {
        return { status: 'blocked', blockedBy: existingLease, hotspot, matchedFiles: matched }
      }
    }

    // No existing lease — grant one for the first matched hotspot.
    const { hotspot, matchedFiles: matched } = checkResult.matches[0]
    const now = this.clock()
    const lease: Lease = {
      id: `lease-${++leaseCounter}`,
      holderId,
      hotspotName: hotspot.name,
      acquiredAt: now,
      expiresAt: ttlMs !== undefined ? new Date(now.getTime() + ttlMs) : undefined,
      matchedFiles: matched,
    }

    this.leases.set(lease.id, lease)

    return { status: 'granted', lease, hotspot, matchedFiles: matched }
  }

  /**
   * Releases a lease by its ID.
   * Returns `true` if the lease was found and removed, `false` otherwise.
   */
  release(leaseId: string): boolean {
    return this.leases.delete(leaseId)
  }

  /**
   * Releases all leases held by a given holder.
   * Returns the number of leases that were released.
   */
  releaseByHolder(holderId: string): number {
    let count = 0
    for (const [id, lease] of this.leases.entries()) {
      if (lease.holderId === holderId) {
        this.leases.delete(id)
        count++
      }
    }
    return count
  }

  /**
   * Returns all currently active (non-expired) leases.
   * Expired leases are pruned before the list is returned.
   */
  listActive(): Lease[] {
    this.pruneExpired()
    return Array.from(this.leases.values())
  }

  /**
   * Removes expired leases from the store.
   * Returns the number of leases removed.
   */
  pruneExpired(): number {
    const now = this.clock()
    let count = 0
    for (const [id, lease] of this.leases.entries()) {
      if (lease.expiresAt !== undefined && lease.expiresAt <= now) {
        this.leases.delete(id)
        count++
      }
    }
    return count
  }

  private findActiveLease(hotspotName: string): Lease | undefined {
    for (const lease of this.leases.values()) {
      if (lease.hotspotName === hotspotName) return lease
    }
    return undefined
  }
}

/** Factory: create a manager pre-loaded with a set of hotspots. */
export function createHotspotLeaseManager(
  hotspots: Hotspot[] = [],
  clock?: ClockFn,
): HotspotLeaseManager {
  const manager = new HotspotLeaseManager(clock)
  for (const h of hotspots) manager.register(h)
  return manager
}
