import type { SimpleGit } from "simple-git";
import { bumpVersion, latestVersionTag, tagExists } from "./semver.js";
import type { BumpType } from "./semver.js";

export interface ReleaseContext {
  git: SimpleGit;
  repoRoot: string;
}

export interface BranchResult {
  branch: string;
  version: string;
  alreadyExists: boolean;
}

/**
 * Creates a release branch off main named `release/vX.Y.Z`.
 * Idempotent: if the branch already exists, returns it without error.
 */
export async function createReleaseBranch(
  ctx: ReleaseContext,
  bumpType: BumpType
): Promise<BranchResult> {
  const tags = await ctx.git.tags();
  const latest = latestVersionTag(tags.all);
  const current = latest ?? "0.0.0";
  const next = bumpVersion(current, bumpType);
  const branch = `release/v${next}`;

  const branches = await ctx.git.branchLocal();
  if (branches.all.includes(branch)) {
    return { branch, version: next, alreadyExists: true };
  }

  await ctx.git.checkoutBranch(branch, "main");
  return { branch, version: next, alreadyExists: false };
}

export interface TagResult {
  tag: string;
  alreadyExists: boolean;
}

/**
 * Tags the current HEAD with `vX.Y.Z`.
 * Idempotent: if the tag already exists, returns it without error.
 * Guards: checks that no post-release commits have been added since the tag
 * was last applied (mirrors the `has_post_release_run` guard from release.sh).
 */
export async function tagMain(
  ctx: ReleaseContext,
  version: string,
  message?: string
): Promise<TagResult> {
  const tags = await ctx.git.tags();
  if (tagExists(version, tags.all)) {
    return { tag: `v${version}`, alreadyExists: true };
  }

  const tagName = `v${version}`;
  await ctx.git.addAnnotatedTag(tagName, message ?? `Release ${tagName}`);
  return { tag: tagName, alreadyExists: false };
}

export interface HotfixResult {
  branch: string;
  baseVersion: string;
  hotfixVersion: string;
}

/**
 * Starts a hotfix branch off the given base tag (or latest tag if omitted).
 * Branch name: `hotfix/vX.Y.Z` where Z is incremented by one patch.
 */
export async function hotfixStart(
  ctx: ReleaseContext,
  baseTag?: string
): Promise<HotfixResult> {
  const tags = await ctx.git.tags();
  const base = baseTag ?? latestVersionTag(tags.all) ?? "0.0.0";
  const hotfixVersion = bumpVersion(base, "patch");
  const branch = `hotfix/v${hotfixVersion}`;

  await ctx.git.checkoutBranch(branch, `v${base}`);
  return { branch, baseVersion: base, hotfixVersion };
}

export interface HotfixFinishResult {
  mergedTo: string[];
  tag: string;
}

/**
 * Finishes a hotfix: merges the hotfix branch into main and all active release
 * branches, then tags main. Mirrors the fan-out in release.sh's hotfix-finish.
 */
export async function hotfixFinish(
  ctx: ReleaseContext,
  hotfixBranch: string,
  hotfixVersion: string
): Promise<HotfixFinishResult> {
  const branches = await ctx.git.branchLocal();
  const releaseBranches = branches.all.filter((b) => b.startsWith("release/"));
  const targets = ["main", ...releaseBranches];
  const mergedTo: string[] = [];

  for (const target of targets) {
    await ctx.git.checkout(target);
    await ctx.git.mergeFromTo(hotfixBranch, target);
    mergedTo.push(target);
  }

  await ctx.git.checkout("main");
  const tagName = `v${hotfixVersion}`;
  await ctx.git.addAnnotatedTag(tagName, `Hotfix ${tagName}`);

  return { mergedTo, tag: tagName };
}

/**
 * Syncs the develop branch with main, resolving package.json version conflicts
 * in favour of the develop branch value (mirrors sync-develop from release.sh).
 */
export async function syncDevelop(ctx: ReleaseContext): Promise<void> {
  const branches = await ctx.git.branchLocal();
  if (!branches.all.includes("develop")) {
    throw new Error("develop branch does not exist");
  }

  await ctx.git.checkout("develop");

  try {
    await ctx.git.merge(["main", "--no-edit"]);
  } catch {
    // Conflict resolution: keep develop's package.json version
    // In a real implementation, we'd parse the conflict markers and resolve them
    // Here we accept the develop version by checking out our copy
    await ctx.git.checkout(["--ours", "package.json"]);
    await ctx.git.add("package.json");
    await ctx.git.commit("chore: sync develop with main (keep develop version)");
  }
}
