import semver from 'semver';
import { simpleGit, SimpleGit } from 'simple-git';

export type BumpType = 'major' | 'minor' | 'patch';

export class SemverBumper {
  private git: SimpleGit;

  constructor(repoPath: string) {
    this.git = simpleGit(repoPath);
  }

  async latestTag(): Promise<string | null> {
    const tags = await this.git.tags(['--sort=-v:refname']);
    const semverTags = tags.all.filter((t) => semver.valid(t));
    return semverTags[0] ?? null;
  }

  async nextVersion(bump: BumpType): Promise<string> {
    const latest = await this.latestTag();
    const base = latest ? semver.clean(latest) ?? '0.0.0' : '0.0.0';
    const next = semver.inc(base, bump);
    if (!next) throw new Error(`Cannot bump ${base} by ${bump}`);
    return next;
  }

  /** Returns true when a post-release commit exists after the given tag. */
  async hasPostReleaseRun(tag: string): Promise<boolean> {
    try {
      const log = await this.git.log({ from: tag, to: 'HEAD' });
      return log.total > 0;
    } catch {
      return false;
    }
  }

  /** Returns true when the given tag already exists on the remote. */
  async tagExists(tag: string): Promise<boolean> {
    const tags = await this.git.tags();
    return tags.all.includes(tag);
  }
}
