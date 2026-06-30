import { randomUUID } from 'node:crypto'
import type {
  AcquireResult,
  Hotspot,
  HotspotConfig,
  HotspotMatch,
  Lease,
} from './types.js'

export type { AcquireResult, Hotspot, HotspotConfig, HotspotMatch, Lease }
export { DEFAULT_LEASE_DURATION_MS }

const DEFAULT_LEASE_DURATION_MS = 30 * 60 * 1000 // 30 minutes

/**
 * Advisory lease manager for declared hotspots.
 *
 * Hotspots are file paths or directories that are expensive to collide on
 * (e.g. a DB migration folder, a shared interface contract). The manager
 * grants at most one lease per hotspot at a time so dispatches touching
 * those paths are serialised without locking the entire repo.
 *
 * Leases are in-memory and advisory — they rely on agents co-operating.
 * Expired leases are evicted lazily on the next access.
 */
export class HotspotManager {
  private readonly hotspots: Hotspot[]
  private readonly defaultDurationMs: number | null
  /** leaseId → Lease */
  private readonly leases = new Map<string, Lease>()
  /** hotspotId → leaseId (at most one active lease per hotspot) */
  private readonly hotspotLease = new Map<string, string>()

  constructor(config: HotspotConfig) {
    this.hotspots = config.hotspots
    this.defaultDurationMs =
      config.defaultLeaseDurationMs !== undefined
        ? config.defaultLeaseDurationMs
        : DEFAULT_LEASE_DURATION_MS
  }

  // ---------------------------------------------------------------------------
  // Pattern matching
  // ---------------------------------------------------------------------------

  /**
   * Returns the hotspots whose patterns match at least one of the given files.
   * Patterns are matched as path prefixes or simple glob wildcards (`*`).
   */
  matchHotspots(files: string[]): HotspotMatch[] {
    const results: HotspotMatch[] = []
    for (const hotspot of this.hotspots) {
      const patterns = Array.isArray(hotspot.patterns)
        ? hotspot.patterns
        : [hotspot.patterns]
      const matched = files.filter(f => patterns.some(p => matchPattern(p, f)))
      if (matched.length > 0) {
        results.push({ hotspot, matchedFiles: matched })
      }
    }
    return results
  }

  // ---------------------------------------------------------------------------
  // Lease operations
  // ---------------------------------------------------------------------------

  /**
   * Attempts to acquire advisory leases on every hotspot matched by `files`.
   *
   * Atomic: if any hotspot is already leased (and not expired), none are
   * acquired and the first blocking lease is returned.
   *
   * Returns `{ acquired: true, leases }` on success or
   * `{ acquired: false, blocking, hotspotId }` if another dispatch holds a lease.
   */
  tryAcquire(
    dispatchId: string,
    ticketId: string,
    files: string[],
    durationMs?: number | null,
  ): AcquireResult {
    this.evictExpired()

    const matches = this.matchHotspots(files)
    if (matches.length === 0) {
      return { acquired: true, leases: [] }
    }

    // Check all hotspots first (atomic: all-or-nothing)
    for (const { hotspot } of matches) {
      const existing = this.activeLease(hotspot.id)
      if (existing && existing.dispatchId !== dispatchId) {
        return { acquired: false, blocking: existing, hotspotId: hotspot.id }
      }
    }

    const resolvedDurationMs =
      durationMs !== undefined ? durationMs : this.defaultDurationMs
    const now = new Date()
    const acquired: Lease[] = []

    for (const { hotspot } of matches) {
      // Skip if this dispatch already holds this hotspot
      const existingLeaseId = this.hotspotLease.get(hotspot.id)
      if (existingLeaseId) {
        const existing = this.leases.get(existingLeaseId)
        if (existing && existing.dispatchId === dispatchId) {
          acquired.push(existing)
          continue
        }
      }

      const lease: Lease = {
        id: randomUUID(),
        hotspotId: hotspot.id,
        dispatchId,
        ticketId,
        acquiredAt: now,
        expiresAt:
          resolvedDurationMs != null
            ? new Date(now.getTime() + resolvedDurationMs)
            : null,
      }
      this.leases.set(lease.id, lease)
      this.hotspotLease.set(hotspot.id, lease.id)
      acquired.push(lease)
    }

    return { acquired: true, leases: acquired }
  }

  /**
   * Releases all leases held by the given dispatch.
   * Returns the number of leases released.
   */
  release(dispatchId: string): number {
    let count = 0
    for (const [leaseId, lease] of this.leases) {
      if (lease.dispatchId === dispatchId) {
        this.hotspotLease.delete(lease.hotspotId)
        this.leases.delete(leaseId)
        count++
      }
    }
    return count
  }

  /**
   * Non-mutating check: returns the blocking lease if any hotspot matched by
   * `files` is currently leased by a *different* dispatch, otherwise null.
   */
  checkAccess(files: string[], requestingDispatchId?: string): Lease | null {
    this.evictExpired()
    for (const { hotspot } of this.matchHotspots(files)) {
      const existing = this.activeLease(hotspot.id)
      if (existing && existing.dispatchId !== (requestingDispatchId ?? '')) {
        return existing
      }
    }
    return null
  }

  /** Returns all currently active (non-expired) leases */
  listLeases(): Lease[] {
    this.evictExpired()
    return Array.from(this.leases.values())
  }

  /** Returns the configured hotspots */
  listHotspots(): Hotspot[] {
    return this.hotspots
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private activeLease(hotspotId: string): Lease | null {
    const leaseId = this.hotspotLease.get(hotspotId)
    if (!leaseId) return null
    const lease = this.leases.get(leaseId)
    if (!lease) return null
    if (lease.expiresAt && lease.expiresAt <= new Date()) {
      // Expired — clean up eagerly
      this.leases.delete(leaseId)
      this.hotspotLease.delete(hotspotId)
      return null
    }
    return lease
  }

  private evictExpired(): void {
    const now = new Date()
    for (const [leaseId, lease] of this.leases) {
      if (lease.expiresAt && lease.expiresAt <= now) {
        this.hotspotLease.delete(lease.hotspotId)
        this.leases.delete(leaseId)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Pattern matching helper
// ---------------------------------------------------------------------------

/**
 * Matches a file path against a pattern.
 * - If the pattern contains `*`, it is treated as a simple glob where `*`
 *   matches any sequence of characters (including `/`).
 * - Otherwise, the file must start with the pattern (prefix match).
 *   A trailing `/` is added to the pattern when absent to avoid
 *   `src/db` matching `src/dbfoo`.
 */
function matchPattern(pattern: string, file: string): boolean {
  if (pattern.includes('*')) {
    // Convert simple glob to regex: escape special chars, replace * with .*
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    const regexStr = escaped.replace(/\*/g, '.*')
    return new RegExp(`^${regexStr}$`).test(file)
  }
  // Prefix match — normalise separator
  const prefix = pattern.endsWith('/') ? pattern : `${pattern}/`
  return file === pattern || file.startsWith(prefix)
}

/** Factory for convenience */
export function createHotspotManager(config: HotspotConfig): HotspotManager {
  return new HotspotManager(config)
}
