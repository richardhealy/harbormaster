import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SimpleGit } from 'simple-git'
import type { OctokitLike } from '../../src/integration/rerun/ci'
import { Rebaser } from '../../src/integration/rerun/rebase'
import { CIChecker } from '../../src/integration/rerun/ci'
import { Rerunner, DEFAULT_MAX_ATTEMPTS } from '../../src/integration/rerun'
import type { WorktreeManager } from '../../src/integration/worktrees'
import type { QueueAdapter } from '../../src/integration/queue/types'

// ---------------------------------------------------------------------------
// Rebaser
// ---------------------------------------------------------------------------

describe('Rebaser', () => {
  let mockGit: SimpleGit
  let rebaser: Rebaser

  beforeEach(() => {
    mockGit = { raw: vi.fn() } as unknown as SimpleGit
    rebaser = new Rebaser(() => mockGit)
  })

  describe('rebase — success', () => {
    it('runs git rebase <newBase> then rev-parse HEAD', async () => {
      vi.mocked(mockGit.raw)
        .mockResolvedValueOnce('') // rebase
        .mockResolvedValueOnce('abc123\n') // rev-parse

      const result = await rebaser.rebase('/wt/disp-1', 'main')

      expect(mockGit.raw).toHaveBeenNthCalledWith(1, ['rebase', 'main'])
      expect(mockGit.raw).toHaveBeenNthCalledWith(2, ['rev-parse', 'HEAD'])
      expect(result).toEqual({ outcome: 'success', headSha: 'abc123' })
    })

    it('trims whitespace from the returned headSha', async () => {
      vi.mocked(mockGit.raw).mockResolvedValueOnce('').mockResolvedValueOnce('  dead1234  \n')
      const result = await rebaser.rebase('/wt/disp-1', 'main')
      expect(result.headSha).toBe('dead1234')
    })

    it('passes the worktreePath to the git factory', async () => {
      const factory = vi.fn(() => mockGit)
      vi.mocked(mockGit.raw).mockResolvedValue('')
      const r = new Rebaser(factory)
      await r.rebase('/some/path', 'main').catch(() => {})
      expect(factory).toHaveBeenCalledWith('/some/path')
    })
  })

  describe('rebase — conflict', () => {
    it('aborts the rebase and returns conflictFiles', async () => {
      vi.mocked(mockGit.raw)
        .mockRejectedValueOnce(new Error('CONFLICT')) // rebase
        .mockResolvedValueOnce('src/a.ts\nsrc/b.ts\n') // diff --name-only
        .mockResolvedValueOnce('') // rebase --abort

      const result = await rebaser.rebase('/wt/disp-1', 'main')

      expect(mockGit.raw).toHaveBeenCalledWith(['rebase', '--abort'])
      expect(result).toEqual({
        outcome: 'conflict',
        conflictFiles: ['src/a.ts', 'src/b.ts'],
      })
    })

    it('filters empty lines from the conflict file list', async () => {
      vi.mocked(mockGit.raw)
        .mockRejectedValueOnce(new Error('CONFLICT'))
        .mockResolvedValueOnce('\nsrc/a.ts\n\n')
        .mockResolvedValueOnce('')

      const result = await rebaser.rebase('/wt/disp-1', 'main')
      expect(result.conflictFiles).toEqual(['src/a.ts'])
    })
  })

  describe('rebase — error', () => {
    it('aborts and returns outcome:error when diff command also fails', async () => {
      vi.mocked(mockGit.raw)
        .mockRejectedValueOnce(new Error('rebase failed'))
        .mockRejectedValueOnce(new Error('diff failed'))
        .mockResolvedValueOnce('') // abort

      const result = await rebaser.rebase('/wt/disp-1', 'main')

      expect(result.outcome).toBe('error')
      expect(result.error).toContain('rebase failed')
    })
  })
})

// ---------------------------------------------------------------------------
// CIChecker
// ---------------------------------------------------------------------------

function makeCheckRun(
  name: string,
  status: 'queued' | 'in_progress' | 'completed',
  conclusion: string | null = null,
) {
  return { name, status, conclusion }
}

describe('CIChecker', () => {
  let octokit: OctokitLike
  let checker: CIChecker

  beforeEach(() => {
    octokit = { request: vi.fn() }
    checker = new CIChecker(octokit, 'acme', 'myapp')
  })

  it('returns "unknown" when there are no check runs', async () => {
    vi.mocked(octokit.request).mockResolvedValueOnce({ data: { check_runs: [] } })
    const result = await checker.checkStatus('abc123')
    expect(result.status).toBe('unknown')
    expect(result.checkRuns).toHaveLength(0)
  })

  it('returns "success" when all check runs completed and pass', async () => {
    vi.mocked(octokit.request).mockResolvedValueOnce({
      data: {
        check_runs: [
          makeCheckRun('build', 'completed', 'success'),
          makeCheckRun('lint', 'completed', 'success'),
        ],
      },
    })
    const result = await checker.checkStatus('abc123')
    expect(result.status).toBe('success')
  })

  it('returns "success" for neutral and skipped conclusions', async () => {
    vi.mocked(octokit.request).mockResolvedValueOnce({
      data: {
        check_runs: [
          makeCheckRun('build', 'completed', 'success'),
          makeCheckRun('optional', 'completed', 'neutral'),
          makeCheckRun('windows', 'completed', 'skipped'),
        ],
      },
    })
    const result = await checker.checkStatus('abc123')
    expect(result.status).toBe('success')
  })

  it('returns "pending" when any check run is still in progress', async () => {
    vi.mocked(octokit.request).mockResolvedValueOnce({
      data: {
        check_runs: [
          makeCheckRun('build', 'completed', 'success'),
          makeCheckRun('tests', 'in_progress'),
        ],
      },
    })
    const result = await checker.checkStatus('abc123')
    expect(result.status).toBe('pending')
  })

  it('returns "pending" when a check run is queued', async () => {
    vi.mocked(octokit.request).mockResolvedValueOnce({
      data: { check_runs: [makeCheckRun('build', 'queued')] },
    })
    const result = await checker.checkStatus('abc123')
    expect(result.status).toBe('pending')
  })

  it('returns "failure" when any completed check has a failing conclusion', async () => {
    vi.mocked(octokit.request).mockResolvedValueOnce({
      data: {
        check_runs: [
          makeCheckRun('build', 'completed', 'success'),
          makeCheckRun('tests', 'completed', 'failure'),
        ],
      },
    })
    const result = await checker.checkStatus('abc123')
    expect(result.status).toBe('failure')
  })

  it('returns "failure" for timed_out and cancelled conclusions', async () => {
    for (const conclusion of ['timed_out', 'cancelled', 'action_required']) {
      vi.mocked(octokit.request).mockResolvedValueOnce({
        data: { check_runs: [makeCheckRun('build', 'completed', conclusion)] },
      })
      const result = await checker.checkStatus('ref')
      expect(result.status).toBe('failure')
    }
  })

  it('passes owner, repo, and ref to the API', async () => {
    vi.mocked(octokit.request).mockResolvedValueOnce({ data: { check_runs: [] } })
    await checker.checkStatus('deadbeef')
    expect(octokit.request).toHaveBeenCalledWith(
      'GET /repos/{owner}/{repo}/commits/{ref}/check-runs',
      expect.objectContaining({ owner: 'acme', repo: 'myapp', ref: 'deadbeef' }),
    )
  })
})

// ---------------------------------------------------------------------------
// Rerunner
// ---------------------------------------------------------------------------

function makeWorktrees(): WorktreeManager {
  return {
    remove: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockResolvedValue({ path: '/wt/new', branch: 'feat/x', dispatchId: 'new-id', headSha: 'new123' }),
    prune: vi.fn(),
    list: vi.fn(),
    worktreePath: vi.fn(),
  } as unknown as WorktreeManager
}

function makeQueue(): QueueAdapter {
  return {
    dequeue: vi.fn().mockResolvedValue(undefined),
    enqueue: vi.fn(),
    getStatus: vi.fn(),
    listQueued: vi.fn(),
  } as unknown as QueueAdapter
}

function makeGit(tip = 'tip123'): SimpleGit {
  return {
    raw: vi.fn().mockResolvedValue(tip + '\n'),
  } as unknown as SimpleGit
}

describe('Rerunner', () => {
  let worktrees: WorktreeManager
  let queue: QueueAdapter
  let git: SimpleGit
  let rerunner: Rerunner

  beforeEach(() => {
    worktrees = makeWorktrees()
    queue = makeQueue()
    git = makeGit()
    rerunner = new Rerunner(worktrees, queue, git)
  })

  describe('shouldRetry', () => {
    it('returns true when attempt < maxAttempts', () => {
      expect(rerunner.shouldRetry(0)).toBe(true)
      expect(rerunner.shouldRetry(1)).toBe(true)
      expect(rerunner.shouldRetry(2)).toBe(true)
    })

    it(`returns false when attempt >= DEFAULT_MAX_ATTEMPTS (${DEFAULT_MAX_ATTEMPTS})`, () => {
      expect(rerunner.shouldRetry(DEFAULT_MAX_ATTEMPTS)).toBe(false)
      expect(rerunner.shouldRetry(DEFAULT_MAX_ATTEMPTS + 1)).toBe(false)
    })

    it('respects a custom maxAttempts', () => {
      expect(rerunner.shouldRetry(0, 1)).toBe(true)
      expect(rerunner.shouldRetry(1, 1)).toBe(false)
    })
  })

  describe('cleanup', () => {
    it('removes the worktree and dequeues the PR', async () => {
      await rerunner.cleanup('disp-1', 42)
      expect(worktrees.remove).toHaveBeenCalledWith('disp-1')
      expect(queue.dequeue).toHaveBeenCalledWith(42)
    })

    it('skips dequeue when prNumber is undefined', async () => {
      await rerunner.cleanup('disp-1')
      expect(worktrees.remove).toHaveBeenCalledWith('disp-1')
      expect(queue.dequeue).not.toHaveBeenCalled()
    })

    it('swallows errors from worktree removal', async () => {
      vi.mocked(worktrees.remove).mockRejectedValueOnce(new Error('gone'))
      await expect(rerunner.cleanup('disp-1')).resolves.toBeUndefined()
    })

    it('swallows errors from queue dequeue', async () => {
      vi.mocked(queue.dequeue).mockRejectedValueOnce(new Error('not found'))
      await expect(rerunner.cleanup('disp-1', 42)).resolves.toBeUndefined()
    })
  })

  describe('currentTip', () => {
    it('returns the trimmed HEAD SHA of the branch', async () => {
      vi.mocked(git.raw).mockResolvedValueOnce('  abc123  \n')
      const tip = await rerunner.currentTip('main')
      expect(git.raw).toHaveBeenCalledWith(['rev-parse', 'main'])
      expect(tip).toBe('abc123')
    })
  })

  describe('handleFailure', () => {
    const baseOptions = {
      dispatchId: 'disp-1',
      branch: 'feat/ENG-1/feature',
      baseBranch: 'main',
      prNumber: 42,
      reason: 'ci_failure' as const,
      attempt: 0,
    }

    it('returns exhausted when attempt >= maxAttempts', async () => {
      const result = await rerunner.handleFailure(
        { ...baseOptions, attempt: DEFAULT_MAX_ATTEMPTS },
        vi.fn(),
      )
      expect(result).toEqual({ requeued: false, exhausted: true })
      expect(worktrees.remove).not.toHaveBeenCalled()
    })

    it('cleans up, resolves new tip, calls redispatch, creates new worktree', async () => {
      const redispatch = vi.fn().mockResolvedValue({
        dispatchId: 'disp-2',
        branch: 'feat/ENG-1/feature-retry1',
      })

      const result = await rerunner.handleFailure(baseOptions, redispatch)

      expect(worktrees.remove).toHaveBeenCalledWith('disp-1')
      expect(queue.dequeue).toHaveBeenCalledWith(42)
      expect(git.raw).toHaveBeenCalledWith(['rev-parse', 'main'])
      expect(redispatch).toHaveBeenCalledWith({
        previousDispatchId: 'disp-1',
        previousBranch: 'feat/ENG-1/feature',
        baseBranch: 'main',
        newBaseSha: 'tip123',
        attempt: 1,
      })
      expect(worktrees.create).toHaveBeenCalledWith({
        dispatchId: 'disp-2',
        branch: 'feat/ENG-1/feature-retry1',
        baseBranch: 'main',
      })
      expect(result).toEqual({
        requeued: true,
        newDispatchId: 'disp-2',
        newBranch: 'feat/ENG-1/feature-retry1',
      })
    })

    it('does not dequeue when prNumber is absent', async () => {
      const redispatch = vi.fn().mockResolvedValue({ dispatchId: 'disp-2', branch: 'feat/x' })
      const options = { ...baseOptions, prNumber: undefined }

      await rerunner.handleFailure(options, redispatch)
      expect(queue.dequeue).not.toHaveBeenCalled()
    })

    it('respects a custom maxAttempts', async () => {
      const result = await rerunner.handleFailure(
        { ...baseOptions, attempt: 1, maxAttempts: 1 },
        vi.fn(),
      )
      expect(result).toEqual({ requeued: false, exhausted: true })
    })

    it('increments the attempt counter passed to redispatch', async () => {
      const redispatch = vi.fn().mockResolvedValue({ dispatchId: 'disp-2', branch: 'b' })
      await rerunner.handleFailure({ ...baseOptions, attempt: 1 }, redispatch)
      expect(redispatch).toHaveBeenCalledWith(expect.objectContaining({ attempt: 2 }))
    })
  })
})
