import type {
  Hotspot,
  HotspotLease,
  AcquireResult,
  HotspotCheck,
  HotspotLeaseManagerConfig,
} from './types'

export type { Hotspot, HotspotLease, AcquireResult, HotspotCheck, HotspotLeaseManagerConfig } from './types'

/**
 * Convert a glob pattern into a RegExp.
 * `**` matches any characters including `/`; `*` matches any non-slash chars.
 */
function globToRegex(pattern: string): RegExp {
  // Split on ** first so that a simple * replacement never touches it.
  const parts = pattern.split('**')
  const escapedParts = parts.map(part =>
    part
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex metacharacters
      .replace(/\*/g, '[^/]*'), // * → any non-separator segment
  )
  // Rejoin with .* (which is the ** expansion)
  const reStr = escapedParts.join('.*')
  return new RegExp(`^${reStr}$`)
}

/**
 * Advisory lease manager for hotspot resources.
 *
 * Hotspots are a small declared set of paths that genuinely punish concurrent
 * modification: database migration files, giant shared contract stubs, or
 * generated type roots. One dispatch holds the lease at a time; others learn
 * the hotspot is held and wait (or are sequenced by the scheduler). This is
 * the exception to the optimistic default, not the architecture.
 */
export class HotspotLeaseManager {
  private readonly leases = new Map<string, HotspotLease>()
  private readonly hotspotMap = new Map<string, Hotspot>()
  private readonly patternCache = new Map<string, RegExp>()
  private readonly leaseTtlMs: number
  private readonly clock: () => number

  constructor(config: HotspotLeaseManagerConfig) {
    this.leaseTtlMs = config.leaseTtlMs ?? 0
    this.clock = config.now ?? (() => Date.now())
    for (const hs of config.hotspots) {
      this.hotspotMap.set(hs.id, hs)
    }
  }

  /**
   * Attempt to acquire the advisory lease for a hotspot on behalf of a dispatch.
   *
   * Non-blocking: returns immediately. When the lease is already held, the
   * caller learns who holds it and since when, and must decide whether to wait,
   * re-queue, or proceed without the advisory protection.
   */
  acquire(hotspotId: string, dispatchId: string): AcquireResult {
    this.purgeExpired()
    const existing = this.leases.get(hotspotId)
    if (existing) {
      return { acquired: false, heldBy: existing.dispatchId, heldSince: existing.acquiredAt, hotspotId }
    }

    const now = this.clock()
    const lease: HotspotLease = {
      hotspotId,
      dispatchId,
      acquiredAt: now,
      expiresAt: this.leaseTtlMs > 0 ? now + this.leaseTtlMs : null,
    }
    this.leases.set(hotspotId, lease)
    return { acquired: true, lease }
  }

  /**
   * Release the lease on a hotspot.
   * Returns false when the lease is not held by the given dispatch (idempotent
   * for the caller — no error, just a false signal).
   */
  release(hotspotId: string, dispatchId: string): boolean {
    const existing = this.leases.get(hotspotId)
    if (!existing || existing.dispatchId !== dispatchId) return false
    this.leases.delete(hotspotId)
    return true
  }

  /** Returns the current lease status for a hotspot. */
  check(hotspotId: string): HotspotCheck {
    this.purgeExpired()
    const lease = this.leases.get(hotspotId) ?? null
    return { hotspotId, isHeld: lease !== null, lease }
  }

  /** Returns all currently-held (non-expired) leases. */
  listHeld(): HotspotLease[] {
    this.purgeExpired()
    return [...this.leases.values()]
  }

  /**
   * Given a list of repo-relative file paths, returns the hotspots they touch.
   * Call this before dispatching a ticket to decide which advisory leases to acquire.
   */
  matchHotspots(files: string[]): Hotspot[] {
    const matched = new Set<string>()
    for (const file of files) {
      for (const hs of this.hotspotMap.values()) {
        if (!matched.has(hs.id) && this.fileMatchesHotspot(file, hs)) {
          matched.add(hs.id)
        }
      }
    }
    return [...matched].map(id => this.hotspotMap.get(id)!)
  }

  /**
   * Purge leases whose TTL has elapsed.
   * Called automatically before every read/write operation.
   * Returns the count of leases removed.
   */
  purgeExpired(): number {
    const now = this.clock()
    let count = 0
    for (const [id, lease] of this.leases) {
      if (lease.expiresAt !== null && now >= lease.expiresAt) {
        this.leases.delete(id)
        count++
      }
    }
    return count
  }

  /** All declared hotspots. */
  get hotspots(): Hotspot[] {
    return [...this.hotspotMap.values()]
  }

  private fileMatchesHotspot(file: string, hotspot: Hotspot): boolean {
    return hotspot.paths.some(p => this.matchPattern(file, p))
  }

  private matchPattern(file: string, pattern: string): boolean {
    let re = this.patternCache.get(pattern)
    if (!re) {
      re = globToRegex(pattern)
      this.patternCache.set(pattern, re)
    }
    return re.test(file)
  }
}

/** Sensible defaults for a TypeScript project using the standard layout. */
export const DEFAULT_HOTSPOTS: Hotspot[] = [
  {
    id: 'db-migrations',
    description:
      'Database migration files — sequential by definition; two agents writing migrations concurrently produce duplicate version numbers or conflicting schema states.',
    paths: ['src/db/migrations/**', 'migrations/**', '**/*.migration.ts', '**/*.migration.sql'],
    advisory: true,
  },
  {
    id: 'shared-contracts',
    description:
      'Root type / contract files imported across many modules; a concurrent change here almost always produces a cross-branch type error.',
    paths: ['src/types/index.ts', 'src/contracts/**', 'src/shared/types/**'],
    advisory: true,
  },
]

export function createHotspotLeaseManager(
  hotspots: Hotspot[] = DEFAULT_HOTSPOTS,
  options: Omit<HotspotLeaseManagerConfig, 'hotspots'> = {},
): HotspotLeaseManager {
  return new HotspotLeaseManager({ hotspots, ...options })
}
