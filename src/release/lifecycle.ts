import simpleGit, { SimpleGit } from 'simple-git';
import * as semver from 'semver';
import { SemverBumpType, ReleaseConfig } from './types';
import { bumpVersion, parseVersion } from './semver';

const DEFAULT_CONFIG: ReleaseConfig = {
  mainBranch: 'main',
  developBranch: 'develop',
  releaseBranchPrefix: 'release/',
  hotfixBranchPrefix: 'hotfix/',
};

export class ReleaseLifecycle {
  private git: SimpleGit;
  readonly config: ReleaseConfig;

  constructor(repoPath: string, config: Partial<ReleaseConfig> = {}) {
    this.git = simpleGit(repoPath);
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async getLatestTag(): Promise<string | null> {
    try {
      const result = await this.git.tags(['--sort=-version:refname']);
      const semverTags = result.all.filter((t) => semver.valid(semver.coerce(t)));
      return semverTags.length > 0 ? semverTags[0] : null;
    } catch {
      return null;
    }
  }

  async autoNextRelease(bumpType: SemverBumpType = 'patch'): Promise<string> {
    const latestTag = await this.getLatestTag();
    if (!latestTag) return '1.0.0';
    const current = parseVersion(latestTag);
    if (!current) return '1.0.0';
    return bumpVersion(current, bumpType);
  }

  async createReleaseBranch(version: string): Promise<string> {
    const branchName = `${this.config.releaseBranchPrefix}${version}`;
    const branches = await this.git.branchLocal();
    if (branches.all.includes(branchName)) {
      throw new Error(`Release branch ${branchName} already exists`);
    }
    await this.git.checkoutBranch(branchName, this.config.mainBranch);
    return branchName;
  }

  async tagMain(version: string): Promise<string> {
    const tagName = `v${version}`;

    const tags = await this.git.tags();
    if (tags.all.includes(tagName)) {
      return tagName;
    }

    const current = (await this.git.revparse(['--abbrev-ref', 'HEAD'])).trim();
    if (current !== this.config.mainBranch) {
      throw new Error(`Must be on ${this.config.mainBranch} to tag; currently on ${current}`);
    }

    await this.git.addTag(tagName);
    return tagName;
  }

  async hotfixStart(baseVersion: string): Promise<string> {
    const parsed = parseVersion(baseVersion);
    if (!parsed) throw new Error(`Invalid base version: ${baseVersion}`);
    const hotfixVersion = bumpVersion(parsed, 'patch');
    const branchName = `${this.config.hotfixBranchPrefix}${hotfixVersion}`;

    const branches = await this.git.branchLocal();
    if (branches.all.includes(branchName)) {
      throw new Error(`Hotfix branch ${branchName} already exists`);
    }

    const sourceRef = `v${parsed}`;
    await this.git.checkoutBranch(branchName, sourceRef);
    return branchName;
  }

  async hotfixFinish(hotfixBranch: string, targetBranches: string[]): Promise<void> {
    const current = (await this.git.revparse(['--abbrev-ref', 'HEAD'])).trim();
    if (current !== hotfixBranch) {
      await this.git.checkout(hotfixBranch);
    }

    for (const target of targetBranches) {
      await this.git.checkout(target);
      await this.git.merge([
        hotfixBranch,
        '--no-ff',
        '-m',
        `Merge ${hotfixBranch} into ${target}`,
      ]);
    }

    await this.git.checkout(this.config.mainBranch);
  }

  async syncDevelop(): Promise<void> {
    await this.git.fetch();
    await this.git.checkout(this.config.developBranch);

    try {
      await this.git.merge([this.config.mainBranch]);
    } catch {
      const status = await this.git.status();
      const conflicts = status.conflicted;

      if (conflicts.length === 1 && conflicts[0] === 'package.json') {
        await this.git.checkout(['--theirs', 'package.json']);
        await this.git.add(['package.json']);
        await this.git.commit(
          `Merge ${this.config.mainBranch} into ${this.config.developBranch} (auto-resolved package.json)`,
        );
      } else if (conflicts.length > 0) {
        throw new Error(`Merge conflicts in: ${conflicts.join(', ')}. Resolve manually.`);
      }
    }
  }

  static featureBranchName(type: string, ticketId: string, description: string): string {
    const slug = description
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return `${type}/${ticketId}-${slug}`;
  }
}
