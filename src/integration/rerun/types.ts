export type RebaseOutcome = 'success' | 'conflict' | 'error'

export interface RebaseResult {
  outcome: RebaseOutcome
  /** HEAD SHA after a successful rebase */
  headSha?: string
  /** Files with merge conflicts (only on 'conflict') */
  conflictFiles?: string[]
  /** Error message (only on 'error') */
  error?: string
}

export type CIStatus = 'pending' | 'success' | 'failure' | 'unknown'

export interface CheckRunSummary {
  name: string
  status: 'queued' | 'in_progress' | 'completed'
  conclusion: string | null
}

export interface CIResult {
  status: CIStatus
  checkRuns: CheckRunSummary[]
}

export type RerunReason = 'rebase_conflict' | 'ci_failure'

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

export interface RerunResult {
  requeued: boolean
  newDispatchId?: string
  newBranch?: string
  /** True when attempt limit is reached; requeued will be false */
  exhausted?: boolean
}

export interface RedispatchParams {
  previousDispatchId: string
  previousBranch: string
  baseBranch: string
  newBaseSha: string
  attempt: number
}

export type RedispatchFn = (
  params: RedispatchParams,
) => Promise<{ dispatchId: string; branch: string }>
