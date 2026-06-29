import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SimpleGit } from 'simple-git'
import { syncDevelop } from '../../src/release/sync'

const mockGit = {
  checkout: vi.fn(),
  merge: vi.fn(),
  add: vi.fn(),
  commit: vi.fn(),
} as unknown as SimpleGit

describe('syncDevelop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(mockGit.checkout).mockResolvedValue(undefined as never)
    vi.mocked(mockGit.add).mockResolvedValue(undefined as never)
    vi.mocked(mockGit.commit).mockResolvedValue(undefined as never)
  })

  it('checks out target and merges source when clean', async () => {
    vi.mocked(mockGit.merge).mockResolvedValue(undefined as never)

    await syncDevelop(mockGit)

    expect(mockGit.checkout).toHaveBeenCalledWith('develop')
    expect(mockGit.merge).toHaveBeenCalledWith(['main'])
  })

  it('auto-resolves package.json conflict and commits', async () => {
    vi.mocked(mockGit.merge).mockRejectedValueOnce(new Error('Merge conflict in package.json'))

    await syncDevelop(mockGit)

    expect(mockGit.checkout).toHaveBeenCalledWith(['--ours', 'package.json'])
    expect(mockGit.add).toHaveBeenCalledWith(['package.json'])
    expect(mockGit.commit).toHaveBeenCalledWith('chore: sync develop from main')
  })

  it('uses custom source and target branches', async () => {
    vi.mocked(mockGit.merge).mockResolvedValue(undefined as never)

    await syncDevelop(mockGit, 'release/1.3.0', 'develop')

    expect(mockGit.checkout).toHaveBeenCalledWith('develop')
    expect(mockGit.merge).toHaveBeenCalledWith(['release/1.3.0'])
  })

  it('uses the custom names in the auto-resolve commit message', async () => {
    vi.mocked(mockGit.merge).mockRejectedValueOnce(new Error('Merge conflict'))
    vi.mocked(mockGit.merge).mockResolvedValue(undefined as never)

    await syncDevelop(mockGit, 'release/2.0.0', 'develop')

    expect(mockGit.commit).toHaveBeenCalledWith('chore: sync develop from release/2.0.0')
  })
})
