export type VersionBump = 'major' | 'minor' | 'patch'

export interface ReleaseContext {
  version: string
  branch: string
  tag: string
  baseBranch: string
}

export interface HotfixContext {
  version: string
  hotfixBranch: string
  sourceBranch: string
}

export interface BranchNameOptions {
  /** Conventional-commit type prefix: feat, fix, chore, docs, etc. */
  type: string
  /** Linear ticket identifier, e.g. "ENG-123" */
  ticketId: string
  /** Short human-readable description, will be slugified */
  description: string
}
