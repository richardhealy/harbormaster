import type { SimpleGit } from 'simple-git'
import type { WorktreeManager } from '../worktrees'
import type { QueueAdapter } from '../queue/types'
import type { RedispatchFn, RerunOptions, RerunResult } from './types'

export type { RebaseOutcome, RebaseResult, GitFactory } from './rebase'
export type { CIResult, CIStatus, CheckRunSummary } from './ci'
export type { RerunOptions, RerunResult, RedispatchFn, RedispatchParams, RerunReason } from './types'
export { Rebaser } from './rebase'
export { CIChecker } from './ci'

export const DEFAULT_MAX_ATTEMPTS = 3

/**
 * Orchestrates the optimistic re-run loop for a failing integration attempt.
 *
 * When a branch fails to integrate (rebase conflict or CI failure), the
 * Rerunner:
 *   1. Checks whether the retry limit has been reached.
 *   2. Removes the failing worktree and dequeues the PR.
 *   3. Resolves the current tip of the base branch.
 *   4. Calls the provided `redispatch` callback to obtain new identifiers.
 *   5. Creates a fresh worktree off the new tip for the re-dispatched work.
 */
export class Rerunner {
  constructor(
    private readonly worktrees: WorktreeManager,
    private readonly queue: QueueAdapter,
    private readonly git: SimpleGit,
  ) {}

  /**
   * Guards against an infinite re-run loop: a branch that keeps losing the
   * race (rebase conflicts or CI failures on every attempt) must eventually
   * be reported as a permanent failure rather than being redispatched forever.
   */
  shouldRetry(attempt: number, maxAttempts = DEFAULT_MAX_ATTEMPTS): boolean {
    return attempt < maxAttempts
  }

  /**
   * Removes the failing worktree and (optionally) dequeues the PR.
   *
   * Errors from either step are swallowed — cleanup is best-effort and runs
   * as part of the failure-recovery path itself, so a cleanup error must not
   * block the re-run from proceeding (which would turn a transient failure
   * into a stuck branch).
   */
  async cleanup(dispatchId: string, prNumber?: number): Promise<void> {
    await this.worktrees.remove(dispatchId).catch(() => {})
    if (prNumber !== undefined) {
      await this.queue.dequeue(prNumber).catch(() => {})
    }
  }

  /**
   * Resolves the current HEAD SHA of `branch` in the main repository — this
   * becomes the new base the re-dispatched attempt rebases onto.
   */
  async currentTip(branch: string): Promise<string> {
    return (await this.git.raw(['rev-parse', branch])).trim()
  }

  /**
   * High-level entry point: cleans up the failing attempt, resolves the new
   * tip, delegates ID generation to `redispatch`, then creates the new
   * worktree ready for the agent to re-run.
   *
   * Returns `{ requeued: false, exhausted: true }` when the retry limit is
   * reached so callers can surface a permanent failure.
   */
  async handleFailure(options: RerunOptions, redispatch: RedispatchFn): Promise<RerunResult> {
    const {
      dispatchId,
      branch,
      baseBranch,
      prNumber,
      attempt,
      maxAttempts = DEFAULT_MAX_ATTEMPTS,
    } = options

    if (!this.shouldRetry(attempt, maxAttempts)) {
      return { requeued: false, exhausted: true }
    }

    await this.cleanup(dispatchId, prNumber)

    const newBaseSha = await this.currentTip(baseBranch)

    const { dispatchId: newDispatchId, branch: newBranch } = await redispatch({
      previousDispatchId: dispatchId,
      previousBranch: branch,
      baseBranch,
      newBaseSha,
      attempt: attempt + 1,
    })

    await this.worktrees.create({ dispatchId: newDispatchId, branch: newBranch, baseBranch })

    return { requeued: true, newDispatchId, newBranch }
  }
}
