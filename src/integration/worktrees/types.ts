export interface WorktreeInfo {
  /** Absolute path to the worktree directory */
  path: string
  /** Git branch checked out in this worktree */
  branch: string
  /** Dispatch ID this worktree was created for */
  dispatchId: string
  /** HEAD commit hash */
  headSha: string
}

export interface CreateWorktreeOptions {
  /** Dispatch ID — used as the worktree directory name */
  dispatchId: string
  /** Branch name to create and check out in the worktree */
  branch: string
  /** Commit-ish to branch from (default: 'main') */
  baseBranch?: string
}
