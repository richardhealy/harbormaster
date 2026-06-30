import type { ImpactSurface } from '../impact'

export type ScheduleDecision = 'parallel' | 'sequence' | 'merge'

/** A unit of work: one or more tickets dispatched as a single agent job */
export interface ScheduledGroup {
  /** Unique group id — ticketId for singles, joined ids for merges */
  id: string
  /** Ticket IDs in this group (length > 1 only for 'merge' decisions) */
  tickets: string[]
  /** How the group was scheduled relative to other groups */
  decision: ScheduleDecision
  /** Human-readable explanation of the scheduling decision */
  reason: string
  /** Jaccard overlap score that triggered merge/sequence (0–1) */
  overlapScore?: number
  /** Combined impact surface (union of all tickets' surfaces) */
  combinedSurface?: ImpactSurface
}

/**
 * A wave is a set of groups that may run concurrently.
 * Waves are ordered: wave[0] runs first, wave[1] after all of wave[0] complete, etc.
 */
export type DispatchWave = ScheduledGroup[]

export interface DispatchPlan {
  /** Ordered execution waves — groups within a wave run in parallel */
  waves: DispatchWave[]
  /** Flat list of all groups in execution order (convenience accessor) */
  groups: ScheduledGroup[]
  /** Number of merged groups (tickets combined into one job) */
  mergeCount: number
  /** Total ticket count across all groups */
  ticketCount: number
  createdAt: Date
}

export interface SchedulerTicket {
  ticketId: string
  /** Lower value = higher priority; influences position within a wave */
  priority?: number
}

export interface SchedulerConfig {
  /** Jaccard overlap above this threshold triggers a merge decision (default 0.5) */
  mergeThreshold: number
  /** Jaccard overlap above zero but below mergeThreshold triggers sequence (default 0) */
  sequenceThreshold: number
}

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  mergeThreshold: 0.5,
  sequenceThreshold: 0,
}
