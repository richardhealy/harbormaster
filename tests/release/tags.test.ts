import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SimpleGit, TagResult, ListLogSummary, DefaultLogFields } from 'simple-git'
import { tagExists, hasPostReleaseRun, tagMain } from '../../src/release/tags'

const mockGit = {
  tags: vi.fn(),
  log: vi.fn(),
  addTag: vi.fn(),
} as unknown as SimpleGit

describe('tagExists', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns true when the tag is present', async () => {
    vi.mocked(mockGit.tags).mockResolvedValue({
      latest: 'v1.2.3',
      all: ['v1.0.0', 'v1.2.3'],
    } as TagResult)

    expect(await tagExists(mockGit, 'v1.2.3')).toBe(true)
  })

  it('returns false when the tag is absent', async () => {
    vi.mocked(mockGit.tags).mockResolvedValue({
      latest: 'v1.2.3',
      all: ['v1.0.0', 'v1.2.3'],
    } as TagResult)

    expect(await tagExists(mockGit, 'v2.0.0')).toBe(false)
  })

  it('returns false on git error', async () => {
    vi.mocked(mockGit.tags).mockRejectedValue(new Error('git error'))
    expect(await tagExists(mockGit, 'v1.0.0')).toBe(false)
  })
})

describe('hasPostReleaseRun', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns false when the tag does not exist yet', async () => {
    vi.mocked(mockGit.tags).mockResolvedValue({ latest: 'v1.2.2', all: ['v1.2.2'] } as TagResult)

    expect(await hasPostReleaseRun(mockGit, '1.2.3')).toBe(false)
  })

  it('returns true when there are commits after the tag', async () => {
    vi.mocked(mockGit.tags).mockResolvedValue({ latest: 'v1.2.3', all: ['v1.2.3'] } as TagResult)
    vi.mocked(mockGit.log).mockResolvedValue({
      all: [{ hash: 'abc123' }],
      total: 1,
      latest: null,
    } as unknown as ListLogSummary<DefaultLogFields>)

    expect(await hasPostReleaseRun(mockGit, '1.2.3')).toBe(true)
  })

  it('returns false when no commits exist after the tag', async () => {
    vi.mocked(mockGit.tags).mockResolvedValue({ latest: 'v1.2.3', all: ['v1.2.3'] } as TagResult)
    vi.mocked(mockGit.log).mockResolvedValue({
      all: [],
      total: 0,
      latest: null,
    } as unknown as ListLogSummary<DefaultLogFields>)

    expect(await hasPostReleaseRun(mockGit, '1.2.3')).toBe(false)
  })
})

describe('tagMain', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates the tag when it does not exist and no post-release commits', async () => {
    vi.mocked(mockGit.tags).mockResolvedValue({ latest: 'v1.2.2', all: ['v1.2.2'] } as TagResult)
    vi.mocked(mockGit.addTag).mockResolvedValue(undefined as never)

    await expect(tagMain(mockGit, '1.2.3')).resolves.toBeUndefined()
    expect(mockGit.addTag).toHaveBeenCalledWith('v1.2.3')
  })

  it('throws when the tag already exists', async () => {
    vi.mocked(mockGit.tags).mockResolvedValue({ latest: 'v1.2.3', all: ['v1.2.3'] } as TagResult)

    await expect(tagMain(mockGit, '1.2.3')).rejects.toThrow('already exists')
  })
})
