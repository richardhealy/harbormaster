import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SimpleGit, TagResult } from 'simple-git'
import { hotfixStart, hotfixFinish } from '../../src/release/hotfix'

const mockGit = {
  tags: vi.fn(),
  checkoutBranch: vi.fn(),
  checkout: vi.fn(),
  merge: vi.fn(),
} as unknown as SimpleGit

describe('hotfixStart', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(mockGit.checkoutBranch).mockResolvedValue(undefined as never)
  })

  it('creates hotfix/<patch-bump> from main', async () => {
    vi.mocked(mockGit.tags).mockResolvedValue({ latest: 'v1.2.3', all: ['v1.2.3'] } as TagResult)

    const ctx = await hotfixStart(mockGit)

    expect(ctx.version).toBe('1.2.4')
    expect(ctx.hotfixBranch).toBe('hotfix/1.2.4')
    expect(ctx.sourceBranch).toBe('main')
    expect(mockGit.checkoutBranch).toHaveBeenCalledWith('hotfix/1.2.4', 'main')
  })

  it('accepts a custom base branch', async () => {
    vi.mocked(mockGit.tags).mockResolvedValue({ latest: 'v2.0.0', all: ['v2.0.0'] } as TagResult)

    const ctx = await hotfixStart(mockGit, 'release/2.0.0')
    expect(ctx.sourceBranch).toBe('release/2.0.0')
  })
})

describe('hotfixFinish', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(mockGit.checkout).mockResolvedValue(undefined as never)
    vi.mocked(mockGit.merge).mockResolvedValue(undefined as never)
  })

  it('fans out to main and develop by default', async () => {
    await hotfixFinish(mockGit, 'hotfix/1.2.4')

    expect(mockGit.checkout).toHaveBeenCalledWith('main')
    expect(mockGit.merge).toHaveBeenCalledWith(['hotfix/1.2.4'])
    expect(mockGit.checkout).toHaveBeenCalledWith('develop')
    expect(mockGit.merge).toHaveBeenCalledTimes(2)
  })

  it('fans out to custom targets including an active release branch', async () => {
    await hotfixFinish(mockGit, 'hotfix/1.2.4', ['main', 'develop', 'release/1.3.0'])

    expect(mockGit.merge).toHaveBeenCalledTimes(3)
    expect(mockGit.merge).toHaveBeenCalledWith(['hotfix/1.2.4'])
    expect(mockGit.checkout).toHaveBeenCalledWith('release/1.3.0')
  })

  it('returns to the hotfix branch when done', async () => {
    await hotfixFinish(mockGit, 'hotfix/1.2.4')

    const checkoutCalls = vi.mocked(mockGit.checkout).mock.calls.map((c) => c[0])
    expect(checkoutCalls.at(-1)).toBe('hotfix/1.2.4')
  })
})
