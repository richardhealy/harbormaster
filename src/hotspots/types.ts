import type { ImpactSurface } from '../impact/types.js'

/** A declared hotspot: a file area or domain that is too costly to collide on */
export interface HotspotDefinition {
  /** Unique identifier, e.g. 'db-migrations' */
  id: string
  description?: string
  /**
   * Path patterns that belong to this hotspot.
   * - Patterns ending with '/' match any file whose path starts with that prefix.
   * - All other patterns match the file path exactly.
   */
  paths: string[]
  /** Optional domain names (from ImpactSurface.domains) that are part of this hotspot */
  domains?: string[]
}

export interface LeaseRecord {
  hotspotId: string
  /** dispatch ID or agent ID that holds the lease */
  holderId: string
  acquiredAt: Date
  /** When set, the lease auto-expires; pruneExpired() will release it */
  expiresAt: Date | undefined
}

export interface AcquireResult {
  acquired: boolean
  /** The holder's ID when acquired=true is the requester; when false, the current holder */
  holderId: string
  acquiredAt: Date | undefined
}

export interface HotspotMatch {
  hotspotId: string
  matchedPaths: string[]
  matchedDomains: string[]
}

export interface HotspotCheckResult {
  touchesHotspot: boolean
  matches: HotspotMatch[]
}

/** Minimal surface shape accepted by registry.check() */
export type CheckInput = Pick<ImpactSurface, 'files' | 'domains'>
