export type SemverBumpType = 'major' | 'minor' | 'patch';

export interface ReleaseConfig {
  mainBranch: string;
  developBranch: string;
  releaseBranchPrefix: string;
  hotfixBranchPrefix: string;
}

export interface ReleaseInfo {
  version: string;
  branch: string;
  tag: string;
}
