export interface Hotspot {
  /** Unique name identifying this hotspot (e.g. "db-migrations", "api-contract") */
  name: string
  /**
   * Glob-style patterns for files/directories this hotspot covers.
   * Trailing `/` → directory prefix match; `**` → any path segments; `*` → within one segment.
   * Examples: ["src/db/migrations/", "**\/*.migration.ts", "src/shared/contract.ts"]
   */
  patterns: string[]
  /** Human-readable reason this hotspot requires an advisory lease */
  reason: string
}

export type LeaseStatus = 'granted' | 'blocked' | 'not-required'

export interface Lease {
  /** Unique lease identifier */
  id: string
  /** ID of the dispatch or agent that holds this lease */
  holderId: string
  /** Name of the hotspot this lease guards */
  hotspotName: string
  /** When the lease was acquired */
  acquiredAt: Date
  /** Optional expiry; undefined means the lease must be released manually */
  expiresAt?: Date
  /** Files from the original request that matched the hotspot's patterns */
  matchedFiles: string[]
}

export interface LeaseRequest {
  /** ID of the requesting dispatch or agent */
  holderId: string
  /** Files the dispatch intends to modify */
  files: string[]
  /** Optional TTL in milliseconds; if omitted the lease has no automatic expiry */
  ttlMs?: number
}

export interface LeaseResult {
  status: LeaseStatus
  /** The newly acquired lease (present when status is 'granted') */
  lease?: Lease
  /** The lease that blocked this request (present when status is 'blocked') */
  blockedBy?: Lease
  /** The hotspot that was matched (present when status is 'granted' or 'blocked') */
  hotspot?: Hotspot
  /** Files from the request that matched the hotspot */
  matchedFiles: string[]
}

export interface HotspotCheckResult {
  /** True when the file list touches at least one registered hotspot */
  touchesHotspot: boolean
  /** All matched hotspots and their corresponding matched files */
  matches: Array<{ hotspot: Hotspot; matchedFiles: string[] }>
}

/** Injectable clock — lets tests control time without real sleeps */
export type ClockFn = () => Date
