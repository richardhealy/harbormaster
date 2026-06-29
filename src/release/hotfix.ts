import { simpleGit, SimpleGit } from 'simple-git';

export class HotfixManager {
  private git: SimpleGit;

  constructor(private repoPath: string) {
    this.git = simpleGit(repoPath);
  }

  /** Start a hotfix branch off main. */
  async start(hotfixName: string, fromBranch = 'main'): Promise<string> {
    const branchName = `hotfix/${hotfixName}`;
    const existing = await this.git.branchLocal();
    if (existing.branches[branchName]) {
      throw new Error(`Hotfix branch ${branchName} already exists`);
    }
    await this.git.checkoutBranch(branchName, fromBranch);
    return branchName;
  }

  /**
   * Finish a hotfix: merge into main, then fan-out to develop and all active
   * release branches. Returns the list of branches that received the merge.
   */
  async finish(
    hotfixBranch: string,
    targets: string[]
  ): Promise<{ branch: string; merged: boolean; error?: string }[]> {
    const results: { branch: string; merged: boolean; error?: string }[] = [];

    for (const target of targets) {
      try {
        await this.git.checkout(target);
        await this.git.merge([hotfixBranch, '--no-ff', '-m', `Merge ${hotfixBranch} into ${target}`]);
        results.push({ branch: target, merged: true });
      } catch (err) {
        results.push({
          branch: target,
          merged: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return results;
  }

  /** Discover active release branches to fan-out the hotfix to. */
  async activeReleaseBranches(): Promise<string[]> {
    const branches = await this.git.branchLocal();
    return Object.keys(branches.branches).filter((b) =>
      b.startsWith('release/')
    );
  }
}
