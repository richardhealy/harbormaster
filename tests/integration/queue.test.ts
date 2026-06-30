import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GitHubMergeQueueAdapter } from '../../src/integration/queue'
import type { OctokitLike } from '../../src/integration/queue'

const OWNER = 'acme'
const REPO = 'myapp'

function makePR(overrides: {
  number?: number
  node_id?: string
  head_ref?: string
  auto_merge?: Record<string, unknown> | null
} = {}) {
  return {
    number: overrides.number ?? 42,
    node_id: overrides.node_id ?? 'PR_node_123',
    head: { ref: overrides.head_ref ?? 'feat/ENG-1/my-feature' },
    auto_merge:
      overrides.auto_merge !== undefined
        ? overrides.auto_merge
        : null,
  }
}

describe('GitHubMergeQueueAdapter', () => {
  let octokit: OctokitLike
  let adapter: GitHubMergeQueueAdapter

  beforeEach(() => {
    octokit = {
      request: vi.fn(),
      graphql: vi.fn(),
    }
    adapter = new GitHubMergeQueueAdapter(octokit, OWNER, REPO)
  })

  describe('enqueue', () => {
    it('fetches the PR and calls enablePullRequestAutoMerge via GraphQL', async () => {
      vi.mocked(octokit.request).mockResolvedValueOnce({ data: makePR() })
      vi.mocked(octokit.graphql!).mockResolvedValueOnce({})

      const entry = await adapter.enqueue(42, 'squash', 'disp-1')

      expect(octokit.request).toHaveBeenCalledWith(
        'GET /repos/{owner}/{repo}/pulls/{pull_number}',
        expect.objectContaining({ owner: OWNER, repo: REPO, pull_number: 42 }),
      )
      expect(octokit.graphql).toHaveBeenCalledWith(
        expect.stringContaining('enablePullRequestAutoMerge'),
        expect.objectContaining({ pullRequestId: 'PR_node_123', mergeMethod: 'SQUASH' }),
      )
      expect(entry).toMatchObject({
        prNumber: 42,
        branch: 'feat/ENG-1/my-feature',
        dispatchId: 'disp-1',
        status: 'queued',
        mergeMethod: 'squash',
      })
      expect(entry.enqueuedAt).toBeInstanceOf(Date)
    })

    it('defaults to squash merge method', async () => {
      vi.mocked(octokit.request).mockResolvedValueOnce({ data: makePR() })
      vi.mocked(octokit.graphql!).mockResolvedValueOnce({})

      const entry = await adapter.enqueue(42)
      expect(entry.mergeMethod).toBe('squash')
    })

    it('supports rebase and merge methods', async () => {
      for (const method of ['rebase', 'merge'] as const) {
        vi.mocked(octokit.request).mockResolvedValueOnce({ data: makePR({ number: 10 }) })
        vi.mocked(octokit.graphql!).mockResolvedValueOnce({})

        const entry = await adapter.enqueue(10, method)
        expect(entry.mergeMethod).toBe(method)

        expect(octokit.graphql).toHaveBeenLastCalledWith(
          expect.anything(),
          expect.objectContaining({ mergeMethod: method.toUpperCase() }),
        )
      }
    })

    it('degrades gracefully when graphql is unavailable', async () => {
      const noGraphql: OctokitLike = { request: octokit.request }
      const adapterNoGraphql = new GitHubMergeQueueAdapter(noGraphql, OWNER, REPO)

      vi.mocked(octokit.request).mockResolvedValueOnce({ data: makePR() })

      const entry = await adapterNoGraphql.enqueue(42)
      expect(entry.status).toBe('queued')
    })
  })

  describe('dequeue', () => {
    it('fetches the PR and calls disablePullRequestAutoMerge', async () => {
      // First enqueue to register in local state
      vi.mocked(octokit.request).mockResolvedValueOnce({ data: makePR() })
      vi.mocked(octokit.graphql!).mockResolvedValueOnce({})
      await adapter.enqueue(42)

      // Now dequeue
      vi.mocked(octokit.request).mockResolvedValueOnce({ data: makePR() })
      vi.mocked(octokit.graphql!).mockResolvedValueOnce({})
      await adapter.dequeue(42)

      expect(octokit.graphql).toHaveBeenLastCalledWith(
        expect.stringContaining('disablePullRequestAutoMerge'),
        expect.objectContaining({ pullRequestId: 'PR_node_123' }),
      )
    })

    it('is a no-op if the PR is not tracked locally', async () => {
      await adapter.dequeue(999)
      expect(octokit.request).not.toHaveBeenCalled()
      expect(octokit.graphql).not.toHaveBeenCalled()
    })

    it('removes the entry from local tracking', async () => {
      vi.mocked(octokit.request).mockResolvedValueOnce({ data: makePR() })
      vi.mocked(octokit.graphql!).mockResolvedValueOnce({})
      await adapter.enqueue(42)

      vi.mocked(octokit.request).mockResolvedValueOnce({ data: makePR() })
      vi.mocked(octokit.graphql!).mockResolvedValueOnce({})
      await adapter.dequeue(42)

      // getStatus should now fall through to GitHub — return null since auto_merge is null
      vi.mocked(octokit.request).mockResolvedValueOnce({ data: makePR({ auto_merge: null }) })
      const status = await adapter.getStatus(42)
      expect(status).toBeNull()
    })
  })

  describe('getStatus', () => {
    it('returns the locally tracked entry without a network call', async () => {
      vi.mocked(octokit.request).mockResolvedValueOnce({ data: makePR() })
      vi.mocked(octokit.graphql!).mockResolvedValueOnce({})
      await adapter.enqueue(42, 'squash', 'disp-1')

      vi.clearAllMocks()
      const status = await adapter.getStatus(42)

      expect(octokit.request).not.toHaveBeenCalled()
      expect(status).not.toBeNull()
      expect(status!.prNumber).toBe(42)
      expect(status!.status).toBe('queued')
    })

    it('queries GitHub when the entry is not tracked locally', async () => {
      vi.mocked(octokit.request).mockResolvedValueOnce({
        data: makePR({
          auto_merge: { merge_method: 'squash', enabled_by: {}, commit_title: '', commit_message: '' },
        }),
      })

      const status = await adapter.getStatus(42)
      expect(status).not.toBeNull()
      expect(status!.prNumber).toBe(42)
      expect(status!.mergeMethod).toBe('squash')
    })

    it('returns null when the PR has no auto-merge and is not tracked', async () => {
      vi.mocked(octokit.request).mockResolvedValueOnce({ data: makePR({ auto_merge: null }) })
      const status = await adapter.getStatus(42)
      expect(status).toBeNull()
    })
  })

  describe('listQueued', () => {
    it('returns PRs with auto-merge enabled', async () => {
      vi.mocked(octokit.request).mockResolvedValueOnce({
        data: [
          makePR({ number: 1, head_ref: 'feat/T1/a', auto_merge: { merge_method: 'squash' } }),
          makePR({ number: 2, head_ref: 'fix/T2/b', auto_merge: null }),
          makePR({ number: 3, head_ref: 'chore/T3/c', auto_merge: { merge_method: 'rebase' } }),
        ],
      })

      const queued = await adapter.listQueued()

      expect(queued).toHaveLength(2)
      expect(queued.map(e => e.prNumber)).toEqual([1, 3])
    })

    it('prefers local tracking data over GitHub data', async () => {
      // Enqueue PR 1 locally with dispatchId
      vi.mocked(octokit.request).mockResolvedValueOnce({ data: makePR({ number: 1 }) })
      vi.mocked(octokit.graphql!).mockResolvedValueOnce({})
      await adapter.enqueue(1, 'squash', 'disp-abc')

      vi.mocked(octokit.request).mockResolvedValueOnce({
        data: [makePR({ number: 1, auto_merge: { merge_method: 'squash' } })],
      })

      const queued = await adapter.listQueued()
      expect(queued[0].dispatchId).toBe('disp-abc')
    })

    it('returns empty array when no PRs have auto-merge enabled', async () => {
      vi.mocked(octokit.request).mockResolvedValueOnce({ data: [] })
      const queued = await adapter.listQueued()
      expect(queued).toHaveLength(0)
    })
  })

  describe('updateStatus', () => {
    it('updates the status of a tracked entry', async () => {
      vi.mocked(octokit.request).mockResolvedValueOnce({ data: makePR() })
      vi.mocked(octokit.graphql!).mockResolvedValueOnce({})
      await adapter.enqueue(42)

      adapter.updateStatus(42, 'merged')

      vi.clearAllMocks()
      const status = await adapter.getStatus(42)
      expect(status!.status).toBe('merged')
    })

    it('is a no-op for untracked entries', () => {
      expect(() => adapter.updateStatus(999, 'merged')).not.toThrow()
    })
  })
})
