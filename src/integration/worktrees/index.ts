import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export interface Worktree {
  path: string;
  branch: string;
  ticketId: string;
}

function git(cmd: string, cwd?: string): string {
  return execSync(`git ${cmd}`, { cwd, encoding: 'utf8' }).trim();
}

function gitSafe(cmd: string, cwd?: string): string | null {
  try {
    return git(cmd, cwd);
  } catch {
    return null;
  }
}

export function createWorktree(
  repoPath: string,
  ticketId: string,
  baseBranch: string,
  worktreeBase: string
): Worktree {
  const safeName = ticketId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const branch = `agent/${safeName}`;
  const worktreePath = path.join(worktreeBase, safeName);

  if (fs.existsSync(worktreePath)) {
    return { path: worktreePath, branch, ticketId };
  }

  git(`worktree add -b ${branch} ${worktreePath} ${baseBranch}`, repoPath);

  return { path: worktreePath, branch, ticketId };
}

export function removeWorktree(repoPath: string, worktreePath: string): void {
  gitSafe(`worktree remove --force ${worktreePath}`, repoPath);
}

export function listWorktrees(repoPath: string): Array<{ path: string; branch: string }> {
  const output = gitSafe('worktree list --porcelain', repoPath);
  if (!output) return [];

  const worktrees: Array<{ path: string; branch: string }> = [];
  const entries = output.split('\n\n');

  for (const entry of entries) {
    const lines = entry.trim().split('\n');
    const pathLine = lines.find((l) => l.startsWith('worktree '));
    const branchLine = lines.find((l) => l.startsWith('branch '));

    if (pathLine && branchLine) {
      worktrees.push({
        path: pathLine.replace('worktree ', ''),
        branch: branchLine.replace('branch refs/heads/', ''),
      });
    }
  }

  return worktrees;
}

export function rebaseWorktree(worktreePath: string, targetBranch: string): boolean {
  try {
    git(`fetch origin ${targetBranch}`, worktreePath);
    git(`rebase origin/${targetBranch}`, worktreePath);
    return true;
  } catch {
    gitSafe('rebase --abort', worktreePath);
    return false;
  }
}
