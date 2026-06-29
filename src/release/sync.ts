import { simpleGit, SimpleGit } from 'simple-git';
import fs from 'fs';
import path from 'path';

export class SyncManager {
  private git: SimpleGit;

  constructor(private repoPath: string) {
    this.git = simpleGit(repoPath);
  }

  /**
   * Sync develop from main, auto-resolving package.json version conflicts by
   * keeping the develop branch's version (the "ours" strategy for that file).
   */
  async syncDevelop(
    developBranch = 'develop',
    mainBranch = 'main'
  ): Promise<{ conflicts: string[] }> {
    await this.git.checkout(developBranch);

    let conflicts: string[] = [];
    try {
      await this.git.merge([mainBranch]);
    } catch {
      // Resolve package.json by keeping ours (develop version wins)
      const pkgPath = path.join(this.repoPath, 'package.json');
      if (fs.existsSync(pkgPath)) {
        await this.git.checkout(['--ours', 'package.json']);
        await this.git.add('package.json');
      }

      const status = await this.git.status();
      conflicts = status.conflicted.filter((f) => f !== 'package.json');

      if (conflicts.length === 0) {
        await this.git.commit(`chore: sync ${developBranch} from ${mainBranch}`, ['--no-edit']);
      }
    }

    return { conflicts };
  }

  /** Build a conventional-commit feature branch name from type and ticket id. */
  static featureBranchName(type: string, ticketId: string, slug: string): string {
    return `${type}/${ticketId}-${slug}`;
  }
}
