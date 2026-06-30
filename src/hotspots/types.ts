/** A declared hotspot: a path or set of paths that punish concurrent modification. */
export interface Hotspot {
  id: string
  /** Human-readable reason this path is a hotspot */
  description: string
  /**
   * Glob patterns or exact repo-relative paths.
   * Supported wildcards: `*` matches any non-separator chars; `**` matches anything.
   */
  paths: string[]
  /** When true, agents should treat this as a hard gate (never skip the check). */
  advisory: boolean
}

/** An active advisory lease held by a dispatch. */
export interface HotspotLease {
  hotspotId: string
  dispatchId: string
  /** Unix epoch milliseconds when the lease was acquired */
  acquiredAt: number
  /** Unix epoch milliseconds when the lease expires; null = never expires */
  expiresAt: number | null
}

export type AcquireResult =
  | { acquired: true; lease: HotspotLease }
  | { acquired: false; heldBy: string; heldSince: number; hotspotId: string }

export interface HotspotCheck {
  hotspotId: string
  isHeld: boolean
  lease: HotspotLease | null
}

export interface HotspotLeaseManagerConfig {
  hotspots: Hotspot[]
  /** Milliseconds before a lease auto-expires; 0 or undefined = no expiry */
  leaseTtlMs?: number
  /** Injectable clock for testability */
  now?: () => number
}
