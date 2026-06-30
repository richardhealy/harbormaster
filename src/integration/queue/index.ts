import type { MergeMethod, QueueAdapter, QueueEntry, QueueEntryStatus } from './types'

export type { MergeMethod, QueueEntry, QueueEntryStatus, QueueAdapter } from './types'

// Minimal Octokit-like interface so the adapter can be tested without a real GitHub connection
export interface OctokitLike {
  request<T = unknown>(
    route: string,
    params?: Record<string, unknown>,
  ): Promise<{ data: T }>
  graphql?: (query: string, params?: Record<string, unknown>) => Promise<unknown>
}

interface GitHubPullRequest {
  number: number
  node_id: string
  head: { ref: string }
  auto_merge: {
    enabled_by: { login: string }
    merge_method: string
    commit_title: string
    commit_message: string
  } | null
}

const ENABLE_AUTO_MERGE = `
  mutation EnableAutoMerge($pullRequestId: ID!, $mergeMethod: PullRequestMergeMethod!) {
    enablePullRequestAutoMerge(input: {
      pullRequestId: $pullRequestId
      mergeMethod: $mergeMethod
    }) {
      pullRequest {
        autoMergeRequest { enabledAt mergeMethod }
      }
    }
  }
`

const DISABLE_AUTO_MERGE = `
  mutation DisableAutoMerge($pullRequestId: ID!) {
    disablePullRequestAutoMerge(input: { pullRequestId: $pullRequestId }) {
      pullRequest { number }
    }
  }
`

/**
 * Adapts harbormaster's queue interface over GitHub's native merge queue.
 *
 * Enabling auto-merge on a PR is the GitHub-side action that submits a PR to
 * the merge queue (when the target branch has merge-queue branch protection).
 * The queue then serializes rebases, runs CI on the merged result, and merges
 * on green — all without harbormaster rebuilding that machinery.
 *
 * Local in-memory state tracks enqueued entries for fast status queries;
 * `getStatus` falls back to the GitHub API when the entry isn't local.
 */
export class GitHubMergeQueueAdapter implements QueueAdapter {
  private readonly tracked = new Map<number, QueueEntry>()

  constructor(
    private readonly octokit: OctokitLike,
    private readonly owner: string,
    private readonly repo: string,
  ) {}

  async enqueue(
    prNumber: number,
    mergeMethod: MergeMethod = 'squash',
    dispatchId?: string,
  ): Promise<QueueEntry> {
    const { data: pr } = await this.octokit.request<GitHubPullRequest>(
      'GET /repos/{owner}/{repo}/pulls/{pull_number}',
      { owner: this.owner, repo: this.repo, pull_number: prNumber },
    )

    if (this.octokit.graphql) {
      await this.octokit.graphql(ENABLE_AUTO_MERGE, {
        pullRequestId: pr.node_id,
        mergeMethod: mergeMethod.toUpperCase(),
      })
    }

    const entry: QueueEntry = {
      prNumber,
      branch: pr.head.ref,
      dispatchId,
      status: 'queued',
      mergeMethod,
      enqueuedAt: new Date(),
    }
    this.tracked.set(prNumber, entry)
    return entry
  }

  async dequeue(prNumber: number): Promise<void> {
    if (!this.tracked.has(prNumber)) return

    const { data: pr } = await this.octokit.request<GitHubPullRequest>(
      'GET /repos/{owner}/{repo}/pulls/{pull_number}',
      { owner: this.owner, repo: this.repo, pull_number: prNumber },
    )

    if (this.octokit.graphql) {
      await this.octokit.graphql(DISABLE_AUTO_MERGE, { pullRequestId: pr.node_id })
    }

    this.tracked.delete(prNumber)
  }

  async getStatus(prNumber: number): Promise<QueueEntry | null> {
    const local = this.tracked.get(prNumber)
    if (local) return local

    // Fall back to the GitHub API
    const { data: pr } = await this.octokit.request<GitHubPullRequest>(
      'GET /repos/{owner}/{repo}/pulls/{pull_number}',
      { owner: this.owner, repo: this.repo, pull_number: prNumber },
    )

    if (!pr.auto_merge) return null

    return {
      prNumber,
      branch: pr.head.ref,
      status: 'queued',
      mergeMethod: (pr.auto_merge.merge_method ?? 'squash') as MergeMethod,
      enqueuedAt: new Date(),
    }
  }

  async listQueued(): Promise<QueueEntry[]> {
    const { data: prs } = await this.octokit.request<GitHubPullRequest[]>(
      'GET /repos/{owner}/{repo}/pulls',
      { owner: this.owner, repo: this.repo, state: 'open', per_page: 100 },
    )

    return prs
      .filter(pr => pr.auto_merge !== null)
      .map(pr => {
        const local = this.tracked.get(pr.number)
        if (local) return local
        return {
          prNumber: pr.number,
          branch: pr.head.ref,
          status: 'queued' as QueueEntryStatus,
          mergeMethod: (pr.auto_merge!.merge_method ?? 'squash') as MergeMethod,
          enqueuedAt: new Date(),
        }
      })
  }

  /** Update entry status — call this from webhook handlers (e.g. merge_group events) */
  updateStatus(prNumber: number, status: QueueEntryStatus): void {
    const entry = this.tracked.get(prNumber)
    if (entry) entry.status = status
  }
}
