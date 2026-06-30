/** A declared hotspot — a file or directory that punishes collide-then-redo */
export interface Hotspot {
  /** Stable identifier for this hotspot (e.g. "db-migrations", "shared-contract") */
  id: string
  /**
   * One or more path prefixes or glob-style patterns (using `*` as a wildcard).
   * A file is matched when it starts with any prefix or matches any pattern.
   */
  patterns: string | string[]
  /** Human-readable explanation of why this hotspot needs advisory locking */
  description: string
}

/** An active advisory lease held by one dispatch on one hotspot */
export interface Lease {
  id: string
  hotspotId: string
  dispatchId: string
  ticketId: string
  acquiredAt: Date
  /** When null the lease does not expire automatically */
  expiresAt: Date | null
}

/** Result of a tryAcquire call */
export type AcquireResult =
  | { acquired: true; leases: Lease[] }
  | { acquired: false; blocking: Lease; hotspotId: string }

/** Configuration passed to HotspotManager */
export interface HotspotConfig {
  hotspots: Hotspot[]
  /** Default lease duration in ms. Null means no automatic expiry. Default: 30 minutes */
  defaultLeaseDurationMs?: number | null
}

/** Which hotspots a set of files touches */
export interface HotspotMatch {
  hotspot: Hotspot
  matchedFiles: string[]
}
