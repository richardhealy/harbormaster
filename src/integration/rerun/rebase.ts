import type { SimpleGit } from 'simple-git'
import type { RebaseOutcome, RebaseResult } from './types'

export type { RebaseOutcome, RebaseResult }

/** Factory that produces a SimpleGit instance scoped to a directory */
export type GitFactory = (workingDir: string) => SimpleGit

/**
 * Rebases a git branch in a worktree directory onto a new base commit.
 *
 * On conflict, aborts the rebase to restore a clean state and returns the
 * list of conflicting files.  On success, returns the new HEAD SHA.
 */
export class Rebaser {
  constructor(private readonly gitFactory: GitFactory) {}

  /**
   * Runs `git rebase <newBase>` in the given worktree.
   *
   * On success, returns the new HEAD SHA. On conflict, the unmerged files are
   * collected and the rebase is aborted so the worktree is left clean and
   * ready for reuse. On any other unexpected failure, the rebase is also
   * aborted and the error is reported instead of being treated as a conflict.
   */
  async rebase(worktreePath: string, newBase: string): Promise<RebaseResult> {
    const git = this.gitFactory(worktreePath)

    try {
      await git.raw(['rebase', newBase])
      const headSha = (await git.raw(['rev-parse', 'HEAD'])).trim()
      return { outcome: 'success', headSha }
    } catch (err) {
      // Collect the unmerged files *before* aborting — `rebase --abort` wipes
      // the conflicted state, so this is the only window in which the caller
      // can learn which files actually conflicted.
      let conflictFiles: string[] = []
      try {
        const statusOut = await git.raw(['diff', '--name-only', '--diff-filter=U'])
        conflictFiles = statusOut.trim().split('\n').filter(Boolean)
      } catch {
        // ignore — we'll still abort and report
      }

      // Abort the in-progress rebase so the worktree is left in a clean state
      await git.raw(['rebase', '--abort']).catch(() => {})

      if (conflictFiles.length > 0) {
        return { outcome: 'conflict', conflictFiles }
      }
      return { outcome: 'error', error: String(err) }
    }
  }
}
