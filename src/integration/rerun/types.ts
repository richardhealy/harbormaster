/**
 * Outcome of attempting to rebase a branch onto a new base:
 * - `success` — the rebase applied cleanly.
 * - `conflict` — the rebase hit merge conflicts and was aborted.
 * - `error` — an unexpected failure occurred (not a conflict) and was aborted.
 */
export type RebaseOutcome = 'success' | 'conflict' | 'error'

/** Result of a {@link RebaseOutcome}-driven rebase attempt. */
export interface RebaseResult {
  outcome: RebaseOutcome
  /** HEAD SHA after a successful rebase */
  headSha?: string
  /** Files with merge conflicts (only on 'conflict') */
  conflictFiles?: string[]
  /** Error message (only on 'error') */
  error?: string
}

/**
 * Aggregate CI status for a ref:
 * - `success` — all check runs completed with a passing conclusion.
 * - `failure` — at least one check run completed with a non-passing conclusion.
 * - `pending` — at least one check run hasn't completed yet (and none have failed).
 * - `unknown` — no check runs are configured for the ref.
 */
export type CIStatus = 'pending' | 'success' | 'failure' | 'unknown'

/** A single GitHub check run as reported by the checks API. */
export interface CheckRunSummary {
  name: string
  status: 'queued' | 'in_progress' | 'completed'
  conclusion: string | null
}

/** Aggregated CI result for a ref, including the individual check runs it was derived from. */
export interface CIResult {
  status: CIStatus
  checkRuns: CheckRunSummary[]
}

/** Why a re-run was triggered. */
export type RerunReason = 'rebase_conflict' | 'ci_failure'

/** Input to {@link Rerunner.handleFailure} describing the failed attempt to re-dispatch. */
export interface RerunOptions {
  dispatchId: string
  branch: string
  baseBranch: string
  prNumber?: number
  reason: RerunReason
  /** Zero-indexed count of previous attempts */
  attempt: number
  maxAttempts?: number
}

/** Result of a re-run attempt. */
export interface RerunResult {
  requeued: boolean
  newDispatchId?: string
  newBranch?: string
  /** True when attempt limit is reached; requeued will be false */
  exhausted?: boolean
}

/** Parameters passed to a {@link RedispatchFn} so it can mint new identifiers for the retry. */
export interface RedispatchParams {
  previousDispatchId: string
  previousBranch: string
  baseBranch: string
  newBaseSha: string
  attempt: number
}

/**
 * Caller-supplied callback that re-dispatches the losing change against the
 * new base and returns the identifiers for the new attempt. Kept as an
 * injected function so {@link Rerunner} stays agnostic of how dispatching
 * actually works (e.g. queuing an agent run).
 */
export type RedispatchFn = (
  params: RedispatchParams,
) => Promise<{ dispatchId: string; branch: string }>
