/**
 * The three semver bump kinds the release flow supports, matching the
 * `npm version <bump>` / `semver.inc` vocabulary used by release.sh.
 */
export type VersionBump = 'major' | 'minor' | 'patch'

/**
 * Describes a cut release branch: the version it carries, the branch and tag
 * names derived from it, and the branch it was cut from.
 */
export interface ReleaseContext {
  version: string
  branch: string
  tag: string
  baseBranch: string
}

/**
 * Describes an in-flight hotfix: the bumped patch version, the
 * `hotfix/<version>` branch it lives on, and the branch it was started from.
 */
export interface HotfixContext {
  version: string
  hotfixBranch: string
  sourceBranch: string
}

/** Inputs for {@link featureBranchName}'s `<type>/<ticketId>/<slug>` convention. */
export interface BranchNameOptions {
  /** Conventional-commit type prefix: feat, fix, chore, docs, etc. */
  type: string
  /** Linear ticket identifier, e.g. "ENG-123" */
  ticketId: string
  /** Short human-readable description, will be slugified */
  description: string
}
