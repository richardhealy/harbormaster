import path from 'path'
import type { SimpleGit } from 'simple-git'
import type { CreateWorktreeOptions, WorktreeInfo } from './types'

export type { WorktreeInfo, CreateWorktreeOptions } from './types'

/**
 * Manages per-task git worktrees off the current tip (spec section "M1 |
 * Worktrees + queue"): one isolated working directory per dispatch so
 * concurrent agents never share a checkout.
 */
export class WorktreeManager {
  constructor(
    private readonly git: SimpleGit,
    private readonly repoRoot: string,
    private readonly worktreeBase: string,
  ) {}

  /** Returns the path where a dispatch's worktree will live */
  worktreePath(dispatchId: string): string {
    return path.join(this.worktreeBase, dispatchId)
  }

  /**
   * Creates a new git worktree for a dispatch.
   * Creates a new branch off `baseBranch` (default 'main') and checks it out
   * in an isolated directory under worktreeBase.
   */
  async create(options: CreateWorktreeOptions): Promise<WorktreeInfo> {
    const { dispatchId, branch, baseBranch = 'main' } = options
    const wtPath = this.worktreePath(dispatchId)

    await this.git.raw(['worktree', 'add', '-b', branch, wtPath, baseBranch])

    const headSha = (await this.git.raw(['rev-parse', branch])).trim()

    return { path: wtPath, branch, dispatchId, headSha }
  }

  /**
   * Removes a dispatch's worktree directory and deregisters it from git.
   * Uses --force to handle uncommitted changes.
   */
  async remove(dispatchId: string): Promise<void> {
    const wtPath = this.worktreePath(dispatchId)
    await this.git.raw(['worktree', 'remove', '--force', wtPath])
  }

  /** Prunes references to worktrees that no longer exist on disk */
  async prune(): Promise<void> {
    await this.git.raw(['worktree', 'prune'])
  }

  /**
   * Lists all worktrees managed under worktreeBase.
   * The main worktree (repoRoot) is excluded.
   */
  async list(): Promise<WorktreeInfo[]> {
    const output = await this.git.raw(['worktree', 'list', '--porcelain'])
    return parseWorktreeList(output, this.worktreeBase)
  }
}

/** Parse `git worktree list --porcelain` output into WorktreeInfo records */
export function parseWorktreeList(raw: string, worktreeBase: string): WorktreeInfo[] {
  const blocks = raw.trim().split(/\n\n+/)
  const result: WorktreeInfo[] = []

  for (const block of blocks) {
    const lines = block.trim().split('\n')
    const get = (prefix: string): string | undefined => {
      const line = lines.find(l => l.startsWith(prefix))
      return line ? line.slice(prefix.length).trim() : undefined
    }

    const wtPath = get('worktree ')
    if (!wtPath) continue

    // Only include worktrees under our managed base directory
    const base = worktreeBase.endsWith(path.sep) ? worktreeBase : worktreeBase + path.sep
    if (!wtPath.startsWith(base)) continue

    const branchRef = get('branch ')
    const branch = branchRef ? branchRef.replace('refs/heads/', '') : ''
    const headSha = get('HEAD ') ?? ''
    const dispatchId = path.basename(wtPath)

    result.push({ path: wtPath, branch, dispatchId, headSha })
  }

  return result
}

/** Factory that creates a WorktreeManager with a default worktree base */
export function createWorktreeManager(
  git: SimpleGit,
  repoRoot: string,
  worktreeBase?: string,
): WorktreeManager {
  return new WorktreeManager(git, repoRoot, worktreeBase ?? path.join(repoRoot, '.worktrees'))
}
