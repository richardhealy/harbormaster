/** How a queued PR should be merged once it clears the queue. */
export type MergeMethod = 'merge' | 'rebase' | 'squash'

/** Lifecycle state of a {@link QueueEntry}. */
export type QueueEntryStatus =
  | 'queued'    // waiting in the queue
  | 'merging'   // currently being rebased / tested
  | 'merged'    // successfully merged
  | 'failed'    // rebase or CI failed
  | 'cancelled' // removed from queue

/** A PR's tracked position/state within the merge queue. */
export interface QueueEntry {
  /** Pull request number */
  prNumber: number
  /** Source branch of the PR */
  branch: string
  /** Dispatch ID that created this PR, if known */
  dispatchId?: string
  status: QueueEntryStatus
  mergeMethod: MergeMethod
  enqueuedAt: Date
}

/**
 * Backend-agnostic interface for submitting PRs to a merge queue.
 * Implemented by `GitHubMergeQueueAdapter`, which delegates to GitHub's
 * native merge queue rather than harbormaster managing queue order itself.
 */
export interface QueueAdapter {
  /**
   * Enqueues a PR. For GitHub, this enables auto-merge, which adds the PR
   * to the merge queue when the target branch has merge-queue protection.
   */
  enqueue(prNumber: number, mergeMethod?: MergeMethod, dispatchId?: string): Promise<QueueEntry>

  /** Removes a PR from the queue by disabling auto-merge. */
  dequeue(prNumber: number): Promise<void>

  /** Returns the current queue entry for a PR, or null if not queued. */
  getStatus(prNumber: number): Promise<QueueEntry | null>

  /** Lists all PRs currently in the queue (auto-merge enabled). */
  listQueued(): Promise<QueueEntry[]>
}
