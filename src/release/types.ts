export type BumpType = 'patch' | 'minor' | 'major';

export interface ReleaseConfig {
  mainBranch: string;
  developBranch: string;
  releaseBranchPrefix: string;
  hotfixBranchPrefix: string;
  tagPrefix: string;
}

export const defaultReleaseConfig: ReleaseConfig = {
  mainBranch: 'main',
  developBranch: 'develop',
  releaseBranchPrefix: 'release/',
  hotfixBranchPrefix: 'hotfix/',
  tagPrefix: 'v',
};

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

export interface ReleaseInfo {
  version: string;
  branch: string;
  tag: string;
  isHotfix: boolean;
}

export interface HotfixInfo {
  version: string;
  branch: string;
  sourceBranch: string;
}
