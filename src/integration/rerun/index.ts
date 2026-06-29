import type { MergeQueueAdapter, QueueEntry } from "../queue/index.js";

export interface RerunResult {
  attempt: number;
  outcome: "queued" | "gave-up";
  reason?: string;
}

const MAX_ATTEMPTS = 5;

/**
 * Re-dispatches a losing change against the new tip of the base branch.
 *
 * When the merge queue rejects a change (conflict or red CI), the change is
 * not lost — it is rebased onto the current tip and re-enqueued. This loop
 * continues up to MAX_ATTEMPTS before giving up and requiring human triage.
 *
 * The rebase itself is handled by the caller (the worktree module), which
 * produces the new headSha passed here.
 */
export async function rerunLosing(
  queue: MergeQueueAdapter,
  entry: QueueEntry,
  newHeadSha: string,
  attempt: number = 1
): Promise<RerunResult> {
  if (attempt > MAX_ATTEMPTS) {
    return {
      attempt,
      outcome: "gave-up",
      reason: `exceeded ${MAX_ATTEMPTS} re-dispatch attempts`,
    };
  }

  const updatedEntry: QueueEntry = {
    ...entry,
    headSha: newHeadSha,
    enqueuedAt: new Date(),
  };

  await queue.enqueue(updatedEntry);

  return { attempt, outcome: "queued" };
}
