import type { ImpactSurface, OverlapAnalysis } from '../impact/types'

/** A ticket paired with its estimated impact surface */
export interface TicketWithImpact {
  ticketId: string
  impact: ImpactSurface
}

/**
 * How to handle the tickets within a DispatchGroup:
 * - `'parallel'`  — each ticket runs as an independent agent concurrently
 *                   with other parallel groups in the same stage.
 * - `'merge'`     — all tickets are combined into one job for a single agent
 *                   (used when their impact surfaces overlap so heavily that
 *                   running them separately would almost certainly collide).
 */
export type GroupDecision = 'parallel' | 'merge'

/** A set of tickets dispatched together within one stage */
export interface DispatchGroup {
  /** Ticket IDs belonging to this group */
  tickets: string[]
  /** Whether to dispatch tickets independently (parallel) or as one job (merge) */
  decision: GroupDecision
  /** Human-readable explanation of the decision */
  reason: string
}

/**
 * A wave of work.  All groups within a stage start at the same time;
 * stage N starts only after stage N-1 has fully completed.
 */
export interface DispatchStage {
  /** 0-indexed; lower stages execute first */
  index: number
  /** Groups that run concurrently within this stage */
  groups: DispatchGroup[]
}

/** Full dispatch plan produced by the Scheduler */
export interface DispatchPlan {
  /** Ordered stages; run them in index order */
  stages: DispatchStage[]
  /** All pairwise overlap analyses that informed sequencing decisions */
  overlaps: OverlapAnalysis[]
}

/** Tunable thresholds for the scheduler */
export interface SchedulerConfig {
  /**
   * Overlap ratio above which two tickets are merged into one job.
   * @default 0.7
   */
  mergeThreshold: number
  /**
   * Overlap ratio at or below which tickets may run in parallel
   * (i.e. the overlap is considered negligible).
   * @default 0  (any detected overlap forces sequencing)
   */
  parallelThreshold: number
}

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  mergeThreshold: 0.7,
  parallelThreshold: 0,
}
