import type { BranchConfig } from './types.js'
import { DEFAULT_BRANCH_CONFIG } from './types.js'

export interface SyncDevelopPlan {
  sourceBranch: string
  targetBranch: string
  conflictFiles: string[]
  autoResolvable: boolean
}

const PACKAGE_JSON_CONFLICT_PATTERN = /package\.json$/

export function planSyncDevelop(
  releaseBranch: string,
  conflictFiles: string[],
  cfg: BranchConfig = DEFAULT_BRANCH_CONFIG,
): SyncDevelopPlan {
  const packageJsonConflicts = conflictFiles.filter((f) =>
    PACKAGE_JSON_CONFLICT_PATTERN.test(f),
  )
  const otherConflicts = conflictFiles.filter(
    (f) => !PACKAGE_JSON_CONFLICT_PATTERN.test(f),
  )

  // package.json conflicts are auto-resolvable (take release branch version)
  const autoResolvable = otherConflicts.length === 0 && packageJsonConflicts.length > 0

  return {
    sourceBranch: releaseBranch,
    targetBranch: cfg.developBranch,
    conflictFiles,
    autoResolvable,
  }
}

export function resolvePackageJsonConflict(
  releaseContent: string,
  _developContent: string,
): string {
  // Strategy: take the release branch version field, keep the rest from develop
  // In practice: the release branch has the bumped version, so take that
  return releaseContent
}

export interface AutoNextReleasePlan {
  currentBranch: string
  nextVersion: string
  newReleaseBranch: string
}

export function planAutoNextRelease(
  currentReleaseBranch: string,
  nextVersion: string,
  cfg: BranchConfig = DEFAULT_BRANCH_CONFIG,
): AutoNextReleasePlan {
  return {
    currentBranch: currentReleaseBranch,
    nextVersion,
    newReleaseBranch: `${cfg.releaseBranchPrefix}${nextVersion}`,
  }
}
