export type QueueProvider = 'github' | 'mergify';

export interface QueueEntry {
  prNumber: number;
  branch: string;
  ticketId: string;
  status: 'queued' | 'merging' | 'merged' | 'failed';
}

export interface MergeQueueAdapter {
  enqueue(prNumber: number, ticketId: string): Promise<QueueEntry>;
  status(prNumber: number): Promise<QueueEntry>;
}
