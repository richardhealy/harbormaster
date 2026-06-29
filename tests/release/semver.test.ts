import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SimpleGit, TagResult } from 'simple-git'
import { bumpVersion, getLatestTag, bumpFromLatestTag } from '../../src/release/semver'

const mockGit = {
  tags: vi.fn(),
  log: vi.fn(),
} as unknown as SimpleGit

describe('bumpVersion', () => {
  it('bumps patch version', () => {
    expect(bumpVersion('1.2.3', 'patch')).toBe('1.2.4')
  })

  it('bumps minor version', () => {
    expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0')
  })

  it('bumps major version', () => {
    expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0')
  })

  it('throws on invalid semver', () => {
    expect(() => bumpVersion('not-semver', 'patch')).toThrow('Invalid semver')
  })

  it('handles 0.0.0 start correctly', () => {
    expect(bumpVersion('0.0.0', 'minor')).toBe('0.1.0')
  })
})

describe('getLatestTag', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the latest tag', async () => {
    vi.mocked(mockGit.tags).mockResolvedValue({
      latest: 'v1.2.3',
      all: ['v1.0.0', 'v1.1.0', 'v1.2.3'],
    } as TagResult)

    const tag = await getLatestTag(mockGit)
    expect(tag).toBe('v1.2.3')
  })

  it('returns null when no tags exist', async () => {
    vi.mocked(mockGit.tags).mockResolvedValue({
      latest: undefined,
      all: [],
    } as unknown as TagResult)

    const tag = await getLatestTag(mockGit)
    expect(tag).toBeNull()
  })

  it('returns null on git error', async () => {
    vi.mocked(mockGit.tags).mockRejectedValue(new Error('git error'))

    const tag = await getLatestTag(mockGit)
    expect(tag).toBeNull()
  })
})

describe('bumpFromLatestTag', () => {
  beforeEach(() => vi.clearAllMocks())

  it('bumps patch from latest tag', async () => {
    vi.mocked(mockGit.tags).mockResolvedValue({
      latest: 'v1.2.3',
      all: ['v1.2.3'],
    } as TagResult)

    const version = await bumpFromLatestTag(mockGit, 'patch')
    expect(version).toBe('1.2.4')
  })

  it('starts from 0.0.0 when no tags exist', async () => {
    vi.mocked(mockGit.tags).mockResolvedValue({
      latest: undefined,
      all: [],
    } as unknown as TagResult)

    const version = await bumpFromLatestTag(mockGit, 'minor')
    expect(version).toBe('0.1.0')
  })

  it('strips v prefix before bumping', async () => {
    vi.mocked(mockGit.tags).mockResolvedValue({
      latest: 'v2.5.1',
      all: ['v2.5.1'],
    } as TagResult)

    const version = await bumpFromLatestTag(mockGit, 'major')
    expect(version).toBe('3.0.0')
  })
})
