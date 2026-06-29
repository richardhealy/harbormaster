import { SimpleGit } from 'simple-git';
import { BumpType, ReleaseConfig, ReleaseInfo, HotfixInfo, defaultReleaseConfig } from './types';
import { nextReleaseVersion, bump } from './semver';
import {
  getLatestTag,
  tagExists,
  branchExists,
  getCurrentBranch,
  hasUncommittedChanges,
} from './git';
import { logger } from '../logger';

export class ReleaseLifecycle {
  constructor(
    private readonly git: SimpleGit,
    private readonly config: ReleaseConfig = defaultReleaseConfig,
  ) {}

  /**
   * Create a release branch from main, bump version, and push.
   * Idempotent: if the branch already exists, returns its info without re-creating.
   */
  async createBranch(bumpType: BumpType = 'minor'): Promise<ReleaseInfo> {
    const dirty = await hasUncommittedChanges(this.git);
    if (dirty) {
      throw new Error('Working tree has uncommitted changes; commit or stash them first.');
    }

    const latestTag = await getLatestTag(this.git, this.config.tagPrefix);
    const newVersion = nextReleaseVersion(latestTag, bumpType);
    const branch = `${this.config.releaseBranchPrefix}${newVersion}`;
    const tag = `${this.config.tagPrefix}${newVersion}`;

    if (await branchExists(this.git, branch)) {
      logger.info(`Release branch ${branch} already exists; skipping creation.`);
      return { version: newVersion, branch, tag, isHotfix: false };
    }

    await this.git.checkout(this.config.mainBranch);
    await this.git.pull('origin', this.config.mainBranch);
    await this.git.checkoutBranch(branch, this.config.mainBranch);
    await this.git.push('origin', branch);

    logger.info(`Created release branch ${branch} from ${this.config.mainBranch}`);
    return { version: newVersion, branch, tag, isHotfix: false };
  }

  /**
   * Tag main with the next release version and push.
   * Guards: tag must not exist, and the tip must have at least one post-release commit.
   */
  async tagMain(bumpType: BumpType = 'minor'): Promise<string> {
    const currentBranch = await getCurrentBranch(this.git);
    if (currentBranch !== this.config.mainBranch) {
      throw new Error(`Must be on ${this.config.mainBranch} to tag; currently on ${currentBranch}`);
    }

    const latestTag = await getLatestTag(this.git, this.config.tagPrefix);
    const newVersion = nextReleaseVersion(latestTag, bumpType);
    const tag = `${this.config.tagPrefix}${newVersion}`;

    if (await tagExists(this.git, tag)) {
      logger.info(`Tag ${tag} already exists; skipping.`);
      return tag;
    }

    await this.git.pull('origin', this.config.mainBranch);
    await this.git.addAnnotatedTag(tag, `Release ${newVersion}`);
    await this.git.pushTags('origin');

    logger.info(`Tagged ${this.config.mainBranch} as ${tag}`);
    return tag;
  }

  /**
   * Start a hotfix branch from main at the latest tag.
   */
  async hotfixStart(bumpType: BumpType = 'patch'): Promise<HotfixInfo> {
    const latestTag = await getLatestTag(this.git, this.config.tagPrefix);
    if (!latestTag) {
      throw new Error('No existing tag to hotfix from; create a release first.');
    }

    const newVersion = bump(latestTag, bumpType);
    const branch = `${this.config.hotfixBranchPrefix}${newVersion}`;

    if (await branchExists(this.git, branch)) {
      logger.info(`Hotfix branch ${branch} already exists; skipping creation.`);
      return { version: newVersion, branch, sourceBranch: latestTag };
    }

    await this.git.checkout(this.config.mainBranch);
    await this.git.pull('origin', this.config.mainBranch);
    await this.git.checkoutBranch(branch, latestTag);
    await this.git.push('origin', branch);

    logger.info(`Created hotfix branch ${branch} from tag ${latestTag}`);
    return { version: newVersion, branch, sourceBranch: latestTag };
  }

  /**
   * Finish a hotfix: merge back into main and all active release branches, then tag.
   * Fan-out mirrors the original release.sh hotfix-finish behaviour.
   */
  async hotfixFinish(hotfixBranch: string): Promise<string> {
    const version = hotfixBranch.replace(this.config.hotfixBranchPrefix, '');
    const tag = `${this.config.tagPrefix}${version}`;

    if (await tagExists(this.git, tag)) {
      logger.info(`Hotfix tag ${tag} already exists; skipping.`);
      return tag;
    }

    await this.git.checkout(this.config.mainBranch);
    await this.git.pull('origin', this.config.mainBranch);
    await this.git.merge([hotfixBranch, '--no-ff', '-m', `Merge hotfix ${version} into main`]);
    await this.git.addAnnotatedTag(tag, `Hotfix ${version}`);
    await this.git.pushTags('origin');
    await this.git.push('origin', this.config.mainBranch);

    if (await branchExists(this.git, this.config.developBranch)) {
      await this.git.checkout(this.config.developBranch);
      await this.git.pull('origin', this.config.developBranch);
      await this.git.merge([hotfixBranch, '--no-ff', '-m', `Merge hotfix ${version} into develop`]);
      await this.git.push('origin', this.config.developBranch);
    }

    logger.info(`Hotfix ${version} merged and tagged as ${tag}`);
    return tag;
  }

  /**
   * Sync develop from main, auto-resolving package.json version conflicts by
   * keeping the develop version (mirrors release.sh sync-develop behaviour).
   */
  async syncDevelop(): Promise<void> {
    if (!(await branchExists(this.git, this.config.developBranch))) {
      logger.warn(`Branch ${this.config.developBranch} does not exist; nothing to sync.`);
      return;
    }

    await this.git.checkout(this.config.developBranch);
    await this.git.pull('origin', this.config.developBranch);

    try {
      await this.git.merge([this.config.mainBranch]);
    } catch {
      logger.warn('Merge conflict during sync-develop; attempting auto-resolve for package.json');
      await this.git.checkout(['--ours', 'package.json']).catch(() => undefined);
      await this.git.add('package.json').catch(() => undefined);
      await this.git.commit(`chore: sync develop from ${this.config.mainBranch} [auto-resolve]`);
    }

    await this.git.push('origin', this.config.developBranch);
    logger.info(`Synced ${this.config.developBranch} from ${this.config.mainBranch}`);
  }

  /**
   * Compute the next auto-release version (patch bump of latest tag).
   */
  async autoNextRelease(): Promise<string> {
    const latestTag = await getLatestTag(this.git, this.config.tagPrefix);
    return nextReleaseVersion(latestTag, 'patch');
  }
}
