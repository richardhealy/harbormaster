import { SimpleGit, simpleGit } from 'simple-git';
import path from 'path';

export function createGit(repoPath: string = process.cwd()): SimpleGit {
  return simpleGit(repoPath);
}

export async function getLatestTag(git: SimpleGit, prefix: string = 'v'): Promise<string | null> {
  try {
    const tags = await git.tags(['--sort=-version:refname', `--list=${prefix}*`]);
    const versionTags = tags.all.filter((t) => t.startsWith(prefix));
    return versionTags[0] ?? null;
  } catch {
    return null;
  }
}

export async function tagExists(git: SimpleGit, tag: string): Promise<boolean> {
  try {
    const tags = await git.tags();
    return tags.all.includes(tag);
  } catch {
    return false;
  }
}

export async function branchExists(git: SimpleGit, branch: string): Promise<boolean> {
  try {
    const branches = await git.branchLocal();
    return branches.all.includes(branch);
  } catch {
    return false;
  }
}

export async function remoteBranchExists(git: SimpleGit, branch: string, remote: string = 'origin'): Promise<boolean> {
  try {
    const branches = await git.branch(['-r']);
    return branches.all.includes(`${remote}/${branch}`);
  } catch {
    return false;
  }
}

export async function getCurrentBranch(git: SimpleGit): Promise<string> {
  const status = await git.status();
  return status.current ?? 'HEAD';
}

export async function hasUncommittedChanges(git: SimpleGit): Promise<boolean> {
  const status = await git.status();
  return !status.isClean();
}

export async function getCommitsBetween(
  git: SimpleGit,
  from: string,
  to: string = 'HEAD',
): Promise<Array<{ hash: string; message: string }>> {
  const log = await git.log({ from, to });
  return log.all.map((c) => ({ hash: c.hash, message: c.message }));
}

export { path };
