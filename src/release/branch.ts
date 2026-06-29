import { simpleGit, SimpleGit } from 'simple-git';
import { SemverBumper, BumpType } from './semver';

export class ReleaseBranchManager {
  private git: SimpleGit;
  private bumper: SemverBumper;

  constructor(private repoPath: string) {
    this.git = simpleGit(repoPath);
    this.bumper = new SemverBumper(repoPath);
  }

  /** Create a release branch off main for the given version. */
  async createBranch(version: string, fromBranch = 'main'): Promise<string> {
    const branchName = `release/${version}`;
    const existing = await this.git.branchLocal();
    if (existing.branches[branchName]) {
      throw new Error(`Branch ${branchName} already exists`);
    }
    await this.git.checkoutBranch(branchName, fromBranch);
    return branchName;
  }

  /** Auto-compute the next version and create its release branch. */
  async autoNextRelease(
    bump: BumpType = 'minor',
    fromBranch = 'main'
  ): Promise<{ version: string; branch: string }> {
    const version = await this.bumper.nextVersion(bump);
    const branch = await this.createBranch(version, fromBranch);
    return { version, branch };
  }

  /** Tag main with the release version — idempotent (no-op if tag exists). */
  async tagMain(version: string, message?: string): Promise<boolean> {
    if (await this.bumper.tagExists(version)) {
      return false; // already tagged — idempotent
    }
    const tagMsg = message ?? `Release ${version}`;
    await this.git.addAnnotatedTag(version, tagMsg);
    return true;
  }

  /** List all open release branches (release/*). */
  async listReleaseBranches(): Promise<string[]> {
    const branches = await this.git.branchLocal();
    return Object.keys(branches.branches).filter((b) =>
      b.startsWith('release/')
    );
  }
}
