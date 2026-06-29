import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SimpleGit, TagResult } from 'simple-git'
import { featureBranchName, createReleaseBranch, autoNextRelease } from '../../src/release/branch'

const mockGit = {
  tags: vi.fn(),
  checkoutBranch: vi.fn(),
} as unknown as SimpleGit

describe('featureBranchName', () => {
  it('produces <type>/<ticketId>/<slug>', () => {
    expect(featureBranchName({ type: 'feat', ticketId: 'ENG-123', description: 'add user auth' })).toBe(
      'feat/ENG-123/add-user-auth',
    )
  })

  it('lowercases and slugifies the description', () => {
    expect(featureBranchName({ type: 'fix', ticketId: 'ENG-456', description: 'Fix Login Bug' })).toBe(
      'fix/ENG-456/fix-login-bug',
    )
  })

  it('removes special characters', () => {
    expect(
      featureBranchName({ type: 'chore', ticketId: 'ENG-789', description: 'update deps & tools' }),
    ).toBe('chore/ENG-789/update-deps--tools')
  })
})

describe('createReleaseBranch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(mockGit.checkoutBranch).mockResolvedValue(undefined as never)
  })

  it('creates release/<version> from main by default', async () => {
    const ctx = await createReleaseBranch(mockGit, '1.3.0')

    expect(mockGit.checkoutBranch).toHaveBeenCalledWith('release/1.3.0', 'main')
    expect(ctx).toEqual({
      version: '1.3.0',
      branch: 'release/1.3.0',
      tag: 'v1.3.0',
      baseBranch: 'main',
    })
  })

  it('accepts a custom base branch', async () => {
    const ctx = await createReleaseBranch(mockGit, '2.0.0', 'develop')

    expect(mockGit.checkoutBranch).toHaveBeenCalledWith('release/2.0.0', 'develop')
    expect(ctx.baseBranch).toBe('develop')
  })
})

describe('autoNextRelease', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(mockGit.checkoutBranch).mockResolvedValue(undefined as never)
  })

  it('creates the next minor release by default', async () => {
    vi.mocked(mockGit.tags).mockResolvedValue({ latest: 'v1.2.3', all: ['v1.2.3'] } as TagResult)

    const ctx = await autoNextRelease(mockGit)
    expect(ctx.version).toBe('1.3.0')
    expect(ctx.branch).toBe('release/1.3.0')
  })

  it('creates the next patch release when specified', async () => {
    vi.mocked(mockGit.tags).mockResolvedValue({ latest: 'v1.2.3', all: ['v1.2.3'] } as TagResult)

    const ctx = await autoNextRelease(mockGit, 'patch')
    expect(ctx.version).toBe('1.2.4')
  })
})
