import type { BranchConfig } from './types.js'
import { hotfixBranchName, isReleaseBranch } from './branch.js'
import { bumpVersion } from './semver.js'
import { DEFAULT_BRANCH_CONFIG } from './types.js'
import { formatTag } from './tag.js'

export interface HotfixStartPlan {
  hotfixBranch: string
  baseBranch: string
  hotfixVersion: string
  hotfixTag: string
}

export interface HotfixFinishPlan {
  hotfixBranch: string
  mergeTargets: string[]
  hotfixTag: string
}

export function planHotfixStart(
  latestTag: string,
  cfg: BranchConfig = DEFAULT_BRANCH_CONFIG,
): HotfixStartPlan {
  const hotfixVersion = bumpVersion(latestTag, 'patch')
  const branch = hotfixBranchName(hotfixVersion, cfg)
  return {
    hotfixBranch: branch,
    baseBranch: cfg.mainBranch,
    hotfixVersion,
    hotfixTag: formatTag(hotfixVersion),
  }
}

export function planHotfixFinish(
  hotfixBranch: string,
  activeBranches: string[],
  cfg: BranchConfig = DEFAULT_BRANCH_CONFIG,
): HotfixFinishPlan {
  // Fan-out: merge hotfix into main, develop, and all active release branches
  const mergeTargets = [
    cfg.mainBranch,
    cfg.developBranch,
    ...activeBranches.filter((b) => isReleaseBranch(b, cfg)),
  ]

  const hotfixVersion = hotfixBranch.replace(cfg.hotfixBranchPrefix, '')

  return {
    hotfixBranch,
    mergeTargets: [...new Set(mergeTargets)],
    hotfixTag: formatTag(hotfixVersion),
  }
}
