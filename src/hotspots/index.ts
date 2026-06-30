import type {
  HotspotDefinition,
  LeaseRecord,
  AcquireResult,
  HotspotMatch,
  HotspotCheckResult,
  CheckInput,
} from './types.js'

export type { HotspotDefinition, LeaseRecord, AcquireResult, HotspotMatch, HotspotCheckResult, CheckInput }

/** Returns true if `filePath` is matched by `pattern` (prefix or exact). */
function matchesPath(filePath: string, pattern: string): boolean {
  if (pattern.endsWith('/')) {
    return filePath.startsWith(pattern)
  }
  return filePath === pattern
}

/**
 * Registry of declared hotspot definitions.
 * Immutable after construction — hotspot definitions are infrastructure config.
 */
export class HotspotRegistry {
  private readonly hotspots: Map<string, HotspotDefinition>

  constructor(hotspots: HotspotDefinition[]) {
    this.hotspots = new Map(hotspots.map((h) => [h.id, h]))
  }

  /** Check whether an impact surface touches any registered hotspot */
  check(surface: CheckInput): HotspotCheckResult {
    const matches: HotspotMatch[] = []

    for (const hotspot of this.hotspots.values()) {
      const matchedPaths = surface.files.filter((f) =>
        hotspot.paths.some((p) => matchesPath(f, p)),
      )

      const matchedDomains = (surface.domains ?? []).filter((d) =>
        (hotspot.domains ?? []).includes(d),
      )

      if (matchedPaths.length > 0 || matchedDomains.length > 0) {
        matches.push({ hotspotId: hotspot.id, matchedPaths, matchedDomains })
      }
    }

    return { touchesHotspot: matches.length > 0, matches }
  }

  list(): HotspotDefinition[] {
    return Array.from(this.hotspots.values())
  }

  get(id: string): HotspotDefinition | undefined {
    return this.hotspots.get(id)
  }
}

/**
 * In-memory advisory lease manager for declared hotspots.
 * A lease prevents a second agent from starting work on the same hotspot
 * while the first agent still holds it.  The holder must call release() when done.
 *
 * This is intentionally in-memory; for a distributed deployment swap in a
 * Postgres-backed store using SELECT FOR UPDATE on a hotspot_leases table.
 */
export class HotspotLeaseManager {
  private readonly leases = new Map<string, LeaseRecord>()

  /**
   * Try to acquire a lease on `hotspotId` for `holderId`.
   * - If the hotspot is free (or held by the same holderId), the lease is granted.
   * - If held by someone else, returns acquired=false with the current holder's id.
   * - `ttlMs` sets an optional expiry; call pruneExpired() to reclaim expired leases.
   */
  acquire(hotspotId: string, holderId: string, ttlMs?: number): AcquireResult {
    this.pruneExpired()

    const existing = this.leases.get(hotspotId)

    if (existing !== undefined && existing.holderId !== holderId) {
      return { acquired: false, holderId: existing.holderId, acquiredAt: existing.acquiredAt }
    }

    const now = new Date()
    const record: LeaseRecord = {
      hotspotId,
      holderId,
      acquiredAt: existing?.acquiredAt ?? now,
      expiresAt: ttlMs !== undefined ? new Date(now.getTime() + ttlMs) : undefined,
    }

    this.leases.set(hotspotId, record)
    return { acquired: true, holderId, acquiredAt: record.acquiredAt }
  }

  /**
   * Release a lease.  Only the current holder can release it.
   * Returns true if the lease was held by `holderId` and has been released.
   */
  release(hotspotId: string, holderId: string): boolean {
    const existing = this.leases.get(hotspotId)
    if (existing === undefined || existing.holderId !== holderId) {
      return false
    }
    this.leases.delete(hotspotId)
    return true
  }

  /** Returns the current lease record, or undefined if the hotspot is free. */
  currentHolder(hotspotId: string): LeaseRecord | undefined {
    this.pruneExpired()
    return this.leases.get(hotspotId)
  }

  /**
   * Remove all expired leases.
   * Returns the number of leases pruned.
   */
  pruneExpired(): number {
    const now = new Date()
    let count = 0
    for (const [id, record] of this.leases) {
      if (record.expiresAt !== undefined && record.expiresAt <= now) {
        this.leases.delete(id)
        count++
      }
    }
    return count
  }

  /** All currently active (non-expired) leases. */
  listActive(): LeaseRecord[] {
    this.pruneExpired()
    return Array.from(this.leases.values())
  }
}

/** Convenience factory: combine registry + lease manager, pre-wired together. */
export function createHotspotManager(hotspots: HotspotDefinition[]): {
  registry: HotspotRegistry
  leases: HotspotLeaseManager
} {
  return { registry: new HotspotRegistry(hotspots), leases: new HotspotLeaseManager() }
}
