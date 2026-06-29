import simpleGit, { SimpleGit } from 'simple-git';
import { bumpVersion, inferBumpType, BumpType } from './semver';
import {
  createReleaseBranch,
  syncDevelop,
  hotfixStart,
  hotfixFinish,
  listReleaseBranches,
  BranchOptions,
} from './branches';
import { tagMain, hasPostReleaseRun, latestReleaseTag, listReleaseTags, TagOptions } from './tags';

export interface ReleaseManagerOptions {
  repoPath: string;
  mainBranch?: string;
  developBranch?: string;
  releaseBranchPrefix?: string;
  hotfixBranchPrefix?: string;
}

/**
 * High-level release lifecycle manager: wraps the low-level branch and tag
 * operations into the workflow ported from release.sh.
 */
export class ReleaseManager {
  private git: SimpleGit;
  private branchOpts: BranchOptions;
  private tagOpts: TagOptions;

  constructor(opts: ReleaseManagerOptions) {
    this.git = simpleGit(opts.repoPath);
    this.branchOpts = {
      git: this.git,
      mainBranch: opts.mainBranch ?? 'main',
      developBranch: opts.developBranch ?? 'develop',
      releaseBranchPrefix: opts.releaseBranchPrefix ?? 'release/',
      hotfixBranchPrefix: opts.hotfixBranchPrefix ?? 'hotfix/',
    };
    this.tagOpts = {
      git: this.git,
      mainBranch: opts.mainBranch ?? 'main',
    };
  }

  async getLatestVersion(): Promise<string | undefined> {
    return latestReleaseTag(this.tagOpts);
  }

  async listTags(): Promise<string[]> {
    return listReleaseTags(this.tagOpts);
  }

  async nextVersion(bumpType?: BumpType, commitMessages?: string[]): Promise<string> {
    const latest = await this.getLatestVersion();
    const current = latest ? latest.replace(/^v/, '') : '0.0.0';
    const bump = bumpType ?? (commitMessages ? inferBumpType(commitMessages) : 'patch');
    return bumpVersion(current, bump);
  }

  async startRelease(version: string) {
    return createReleaseBranch(this.branchOpts, version);
  }

  async tagRelease(version: string) {
    return tagMain(this.tagOpts, version);
  }

  async syncDevelop() {
    return syncDevelop(this.branchOpts);
  }

  async startHotfix(version: string) {
    return hotfixStart(this.branchOpts, version);
  }

  async finishHotfix(version: string) {
    return hotfixFinish(this.branchOpts, version);
  }

  async hasPostReleaseRun(version: string): Promise<boolean> {
    return hasPostReleaseRun(this.tagOpts, version);
  }

  async listReleaseBranches(): Promise<string[]> {
    return listReleaseBranches(this.branchOpts);
  }
}
