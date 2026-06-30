/** An agent branch that is currently in-flight (dispatched but not yet merged) */
export interface InFlightBranch {
  dispatchId: string
  branch: string
  worktreePath: string
  ticketId?: string
}

export interface TypecheckResult {
  clean: boolean
  /** Individual error lines extracted from tsc output */
  errors: string[]
  output: string
}

/** Injectable: run tsc --noEmit in a directory and return the result */
export type TypecheckRunner = (workingDir: string) => Promise<TypecheckResult>

/**
 * Injectable: create and destroy a temporary merged view of two worktrees.
 *
 * `create` copies worktreeA and overlays the files changed by worktreeB
 * (relative to the common ancestor on main) to approximate a two-branch merge.
 */
export interface MergeViewFactory {
  create(worktreeA: string, worktreeB: string): Promise<string>
  cleanup(dir: string): Promise<void>
}

export type PairOutcome = 'clean' | 'conflict' | 'error'

export interface PairCheckResult {
  dispatchIdA: string
  dispatchIdB: string
  outcome: PairOutcome
  /** Errors that appear in the merged view but not in either branch alone */
  newErrors: string[]
  message?: string
}

export interface SemanticCheckResult {
  /** Pairs that produced new cross-branch type errors */
  conflicts: PairCheckResult[]
  /** Results for every pair that was checked */
  allPairs: PairCheckResult[]
  /** Number of unique branch pairs checked */
  checkedPairs: number
  /** True when no new cross-branch type errors were found */
  clean: boolean
}
