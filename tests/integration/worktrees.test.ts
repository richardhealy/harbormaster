import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SimpleGit } from 'simple-git'
import { WorktreeManager, parseWorktreeList, createWorktreeManager } from '../../src/integration/worktrees'

const REPO_ROOT = '/repo'
const WORKTREE_BASE = '/repo/.worktrees'

const mockGit = {
  raw: vi.fn(),
} as unknown as SimpleGit

describe('WorktreeManager', () => {
  let manager: WorktreeManager

  beforeEach(() => {
    vi.clearAllMocks()
    manager = new WorktreeManager(mockGit, REPO_ROOT, WORKTREE_BASE)
  })

  describe('worktreePath', () => {
    it('returns <worktreeBase>/<dispatchId>', () => {
      expect(manager.worktreePath('disp-1')).toBe('/repo/.worktrees/disp-1')
    })
  })

  describe('create', () => {
    it('runs git worktree add -b <branch> <path> <baseBranch>', async () => {
      vi.mocked(mockGit.raw)
        .mockResolvedValueOnce('') // worktree add
        .mockResolvedValueOnce('abc123\n') // rev-parse

      const info = await manager.create({
        dispatchId: 'disp-1',
        branch: 'feat/ENG-1/my-feature',
        baseBranch: 'main',
      })

      expect(mockGit.raw).toHaveBeenNthCalledWith(1, [
        'worktree',
        'add',
        '-b',
        'feat/ENG-1/my-feature',
        '/repo/.worktrees/disp-1',
        'main',
      ])
      expect(info).toMatchObject({
        path: '/repo/.worktrees/disp-1',
        branch: 'feat/ENG-1/my-feature',
        dispatchId: 'disp-1',
        headSha: 'abc123',
      })
    })

    it('defaults baseBranch to "main"', async () => {
      vi.mocked(mockGit.raw).mockResolvedValue('')

      await manager.create({ dispatchId: 'disp-2', branch: 'feat/ENG-2/x' })

      const firstCall = vi.mocked(mockGit.raw).mock.calls[0][0] as unknown as string[]
      expect(firstCall[firstCall.length - 1]).toBe('main')
    })

    it('trims trailing newline from headSha', async () => {
      vi.mocked(mockGit.raw)
        .mockResolvedValueOnce('')
        .mockResolvedValueOnce('  deadbeef  \n')

      const info = await manager.create({ dispatchId: 'disp-3', branch: 'feat/ENG-3/trim' })
      expect(info.headSha).toBe('deadbeef')
    })
  })

  describe('remove', () => {
    it('runs git worktree remove --force <path>', async () => {
      vi.mocked(mockGit.raw).mockResolvedValue('')

      await manager.remove('disp-1')

      expect(mockGit.raw).toHaveBeenCalledWith([
        'worktree',
        'remove',
        '--force',
        '/repo/.worktrees/disp-1',
      ])
    })
  })

  describe('prune', () => {
    it('runs git worktree prune', async () => {
      vi.mocked(mockGit.raw).mockResolvedValue('')

      await manager.prune()

      expect(mockGit.raw).toHaveBeenCalledWith(['worktree', 'prune'])
    })
  })

  describe('list', () => {
    it('returns worktrees under worktreeBase and excludes the main worktree', async () => {
      const porcelain = [
        'worktree /repo/.worktrees/disp-1',
        'HEAD abc123',
        'branch refs/heads/feat/ENG-1/feature',
        '',
        'worktree /repo',
        'HEAD def456',
        'branch refs/heads/main',
      ].join('\n')

      vi.mocked(mockGit.raw).mockResolvedValue(porcelain)
      const result = await manager.list()

      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        dispatchId: 'disp-1',
        branch: 'feat/ENG-1/feature',
        headSha: 'abc123',
        path: '/repo/.worktrees/disp-1',
      })
    })

    it('returns empty array when no managed worktrees exist', async () => {
      vi.mocked(mockGit.raw).mockResolvedValue(
        'worktree /repo\nHEAD abc\nbranch refs/heads/main\n',
      )
      const result = await manager.list()
      expect(result).toHaveLength(0)
    })
  })
})

describe('parseWorktreeList', () => {
  it('parses multiple worktrees correctly', () => {
    const input = [
      'worktree /repo/.worktrees/job-a',
      'HEAD aaa111',
      'branch refs/heads/feat/T-1/add-auth',
      '',
      'worktree /repo/.worktrees/job-b',
      'HEAD bbb222',
      'branch refs/heads/fix/T-2/fix-login',
      '',
      'worktree /repo',
      'HEAD ccc333',
      'branch refs/heads/main',
    ].join('\n')

    const result = parseWorktreeList(input, '/repo/.worktrees')

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      dispatchId: 'job-a',
      branch: 'feat/T-1/add-auth',
      headSha: 'aaa111',
      path: '/repo/.worktrees/job-a',
    })
    expect(result[1]).toMatchObject({
      dispatchId: 'job-b',
      branch: 'fix/T-2/fix-login',
      headSha: 'bbb222',
    })
  })

  it('handles detached HEAD state (no branch line)', () => {
    const input = [
      'worktree /repo/.worktrees/job-c',
      'HEAD ccc333',
      'detached',
    ].join('\n')

    const result = parseWorktreeList(input, '/repo/.worktrees')
    expect(result).toHaveLength(1)
    expect(result[0].branch).toBe('')
    expect(result[0].headSha).toBe('ccc333')
  })

  it('returns empty array when raw output is empty', () => {
    expect(parseWorktreeList('', '/repo/.worktrees')).toHaveLength(0)
  })
})

describe('createWorktreeManager', () => {
  it('uses <repoRoot>/.worktrees as the default base', () => {
    const manager = createWorktreeManager(mockGit, '/repo')
    expect(manager.worktreePath('x')).toBe('/repo/.worktrees/x')
  })

  it('accepts a custom worktreeBase', () => {
    const manager = createWorktreeManager(mockGit, '/repo', '/tmp/wt')
    expect(manager.worktreePath('x')).toBe('/tmp/wt/x')
  })
})
