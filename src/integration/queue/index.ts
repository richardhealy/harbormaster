/**
 * Adapter over GitHub's merge queue (or Mergify).
 *
 * harbormaster does not build a merge queue — it wraps the one GitHub already
 * provides. The adapter's job is:
 *   1. Add a branch to the queue (via PR label or API call).
 *   2. Poll or receive webhook events for queue outcomes.
 *   3. On failure (conflict or red CI), signal the rerun module.
 */

export interface QueueEntry {
  prNumber: number;
  headSha: string;
  branch: string;
  ticketId: string;
  enqueuedAt: Date;
}

export type QueueOutcome =
  | { status: "merged"; mergedSha: string }
  | { status: "failed"; reason: "conflict" | "ci" | "timeout" }
  | { status: "pending" };

export interface MergeQueueAdapter {
  /** Enqueues a PR into the merge queue by adding the required label. */
  enqueue(entry: QueueEntry): Promise<void>;
  /** Checks the current outcome for a queued PR. */
  checkOutcome(prNumber: number): Promise<QueueOutcome>;
  /** Removes a PR from the queue (e.g. before re-dispatch). */
  dequeue(prNumber: number): Promise<void>;
}

/**
 * A no-op adapter used in tests and local development.
 * Real adapters (GitHub, Mergify) implement this interface.
 */
export class NoopMergeQueueAdapter implements MergeQueueAdapter {
  private readonly queue = new Map<number, QueueEntry>();

  async enqueue(entry: QueueEntry): Promise<void> {
    this.queue.set(entry.prNumber, entry);
  }

  async checkOutcome(prNumber: number): Promise<QueueOutcome> {
    return this.queue.has(prNumber)
      ? { status: "pending" }
      : { status: "failed", reason: "conflict" };
  }

  async dequeue(prNumber: number): Promise<void> {
    this.queue.delete(prNumber);
  }
}
