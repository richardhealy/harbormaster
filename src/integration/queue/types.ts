export type MergeMethod = 'merge' | 'rebase' | 'squash'

export type QueueEntryStatus =
  | 'queued'    // waiting in the queue
  | 'merging'   // currently being rebased / tested
  | 'merged'    // successfully merged
  | 'failed'    // rebase or CI failed
  | 'cancelled' // removed from queue

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
