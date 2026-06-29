export type SemverBump = 'major' | 'minor' | 'patch'

export interface ReleaseVersion {
  major: number
  minor: number
  patch: number
  raw: string
}

export interface BranchConfig {
  mainBranch: string
  developBranch: string
  releaseBranchPrefix: string
  hotfixBranchPrefix: string
}

export const DEFAULT_BRANCH_CONFIG: BranchConfig = {
  mainBranch: 'main',
  developBranch: 'develop',
  releaseBranchPrefix: 'release/',
  hotfixBranchPrefix: 'hotfix/',
}

export type FeatureType =
  | 'feat'
  | 'fix'
  | 'chore'
  | 'docs'
  | 'refactor'
  | 'test'
  | 'perf'
  | 'ci'

export interface FeatureBranchName {
  type: FeatureType
  ticketId: string
  slug: string
}
