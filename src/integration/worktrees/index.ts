import { simpleGit } from "simple-git";
import { join } from "path";
import { mkdir, rm } from "fs/promises";
import { randomUUID } from "crypto";

export interface WorktreeOptions {
  repoRoot: string;
  worktreesRoot: string;
  branch: string;
  baseBranch?: string;
}

export interface WorktreeHandle {
  id: string;
  path: string;
  branch: string;
  cleanup(): Promise<void>;
}

/**
 * Creates an isolated git worktree for a single agent task.
 *
 * Each agent works in its own worktree off the current tip of the base branch.
 * This means multiple agents can work simultaneously on the same repo without
 * touching each other's working directory.
 */
export async function createWorktree(
  opts: WorktreeOptions
): Promise<WorktreeHandle> {
  const id = randomUUID();
  const path = join(opts.worktreesRoot, id);
  await mkdir(path, { recursive: true });

  const git = simpleGit(opts.repoRoot);
  const base = opts.baseBranch ?? "main";
  const branch = opts.branch;

  await git.raw(["worktree", "add", "-b", branch, path, base]);

  return {
    id,
    path,
    branch,
    async cleanup() {
      await git.raw(["worktree", "remove", "--force", path]);
      await rm(path, { recursive: true, force: true });
    },
  };
}

/**
 * Lists all worktrees for the given repo.
 */
export async function listWorktrees(
  repoRoot: string
): Promise<Array<{ path: string; branch: string; head: string }>> {
  const git = simpleGit(repoRoot);
  const raw = await git.raw(["worktree", "list", "--porcelain"]);

  const worktrees: Array<{ path: string; branch: string; head: string }> = [];
  let current: Partial<{ path: string; branch: string; head: string }> = {};

  for (const line of raw.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current.path) worktrees.push(current as { path: string; branch: string; head: string });
      current = { path: line.slice("worktree ".length) };
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length).replace("refs/heads/", "");
    }
  }
  if (current.path) worktrees.push(current as { path: string; branch: string; head: string });

  return worktrees;
}
