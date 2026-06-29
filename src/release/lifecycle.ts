import {
  ReleaseContext,
  ReleaseInfo,
  HotfixInfo,
  SemverBump,
  FeatureBranchOpts,
} from './types';
import {
  nextVersion,
  formatTag,
  releaseBranchName,
  latestVersionFromTags,
  bumpVersion,
} from './semver';

export class ReleaseLifecycle {
  constructor(private ctx: ReleaseContext) {}

  get cfg() {
    return this.ctx.config;
  }

  get git() {
    return this.ctx.git;
  }

  async createRelease(bump: SemverBump): Promise<ReleaseInfo> {
    const tags = await this.git.tags();
    const version = nextVersion(tags, bump, this.cfg.tagPrefix);
    const branch = releaseBranchName(version, this.cfg.releaseBranchPrefix);
    const tag = formatTag(version, this.cfg.tagPrefix);

    const branchAlreadyExists = await this.git.branchExists(branch);
    if (branchAlreadyExists) {
      return { version, branch, tag, isNew: false };
    }

    await this.git.createBranch(branch, this.cfg.mainBranch);
    await this.updatePackageVersion(version);

    return { version, branch, tag, isNew: true };
  }

  async autoNextRelease(bump: SemverBump): Promise<ReleaseInfo> {
    const tags = await this.git.tags();
    const version = nextVersion(tags, bump, this.cfg.tagPrefix);
    const branch = releaseBranchName(version, this.cfg.releaseBranchPrefix);
    const tag = formatTag(version, this.cfg.tagPrefix);

    const branchAlreadyExists = await this.git.branchExists(branch);
    if (!branchAlreadyExists) {
      await this.git.createBranch(branch, this.cfg.mainBranch);
    }

    await this.updatePackageVersion(version);
    return { version, branch, tag, isNew: !branchAlreadyExists };
  }

  async tagMain(): Promise<{ tag: string; skipped: boolean }> {
    const tags = await this.git.tags();
    const latest = latestVersionFromTags(tags, this.cfg.tagPrefix);
    if (!latest) throw new Error('No existing tags found; cannot tag main');

    const tag = formatTag(latest, this.cfg.tagPrefix);

    const alreadyTagged = await this.git.tagExists(tag);
    if (alreadyTagged) {
      return { tag, skipped: true };
    }

    const hasPostReleaseChanges = await this.hasPostReleaseRun(latest);
    if (!hasPostReleaseChanges) {
      return { tag, skipped: true };
    }

    await this.git.tag(tag, `Release ${latest}`);
    await this.git.pushTag(tag);
    return { tag, skipped: false };
  }

  async hotfixStart(bump: SemverBump = 'patch'): Promise<HotfixInfo> {
    const tags = await this.git.tags();
    const latest = latestVersionFromTags(tags, this.cfg.tagPrefix);
    const base = latest ?? '0.0.0';
    const version = bumpVersion(base, bump);
    const branch = `${this.cfg.hotfixBranchPrefix}${version}`;

    const branchAlreadyExists = await this.git.branchExists(branch);
    if (!branchAlreadyExists) {
      await this.git.createBranch(branch, this.cfg.mainBranch);
    }

    await this.updatePackageVersion(version);
    return { version, branch, basedOn: this.cfg.mainBranch };
  }

  async hotfixFinish(hotfixBranch: string): Promise<void> {
    const currentBranches = await this.git.branches();

    await this.git.checkout(this.cfg.mainBranch);
    await this.git.merge(hotfixBranch, { noFF: true });

    if (currentBranches.includes(this.cfg.developBranch)) {
      await this.git.checkout(this.cfg.developBranch);
      await this.git.merge(hotfixBranch, { noFF: true });
    }

    const releaseBranches = currentBranches.filter((b) =>
      b.startsWith(this.cfg.releaseBranchPrefix)
    );
    for (const rb of releaseBranches) {
      await this.git.checkout(rb);
      await this.git.merge(hotfixBranch, { noFF: true });
    }

    await this.git.checkout(this.cfg.mainBranch);
    await this.git.deleteBranch(hotfixBranch);
  }

  async syncDevelop(): Promise<void> {
    const currentBranches = await this.git.branches();
    if (!currentBranches.includes(this.cfg.developBranch)) {
      return;
    }

    const mainPkg = await this.readPackageVersion(this.cfg.mainBranch);
    const devPkg = await this.readPackageVersion(this.cfg.developBranch);

    await this.git.checkout(this.cfg.developBranch);
    await this.git.merge(this.cfg.mainBranch);

    if (mainPkg && devPkg && mainPkg !== devPkg) {
      await this.updatePackageVersion(devPkg);
    }
  }

  featureBranchName(opts: FeatureBranchOpts): string {
    const slug = opts.description
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50);
    return `${opts.type}/${opts.ticketId}-${slug}`;
  }

  async createFeatureBranch(opts: FeatureBranchOpts): Promise<string> {
    const base = opts.base ?? this.cfg.mainBranch;
    const name = this.featureBranchName(opts);
    const exists = await this.git.branchExists(name);
    if (!exists) {
      await this.git.createBranch(name, base);
    }
    return name;
  }

  private async hasPostReleaseRun(version: string): Promise<boolean> {
    const tag = formatTag(version, this.cfg.tagPrefix);
    const exists = await this.git.tagExists(tag);
    if (!exists) return true;

    const commits = await this.git.log(tag, this.cfg.mainBranch);
    return commits.length > 0;
  }

  private async updatePackageVersion(version: string): Promise<void> {
    const content = await this.git.readFile('package.json');
    if (!content) return;

    const pkg = JSON.parse(content) as { version?: string };
    pkg.version = version;
    await this.git.writeFile('package.json', JSON.stringify(pkg, null, 2) + '\n');
    await this.git.commit(`chore: bump version to ${version}`);
  }

  private async readPackageVersion(branch: string): Promise<string | null> {
    await this.git.checkout(branch);
    const content = await this.git.readFile('package.json');
    if (!content) return null;
    const pkg = JSON.parse(content) as { version?: string };
    return pkg.version ?? null;
  }
}

export function defaultReleaseConfig() {
  return {
    mainBranch: 'main',
    developBranch: 'develop',
    releaseBranchPrefix: 'release/',
    hotfixBranchPrefix: 'hotfix/',
    tagPrefix: 'v',
  };
}
