import { SimpleGit } from 'simple-git';

export interface BranchOptions {
  git: SimpleGit;
  mainBranch: string;
  developBranch: string;
  releaseBranchPrefix: string;
  hotfixBranchPrefix: string;
}

export interface CreateReleaseBranchResult {
  branch: string;
  alreadyExisted: boolean;
}

/**
 * Create a release branch off main. Idempotent: if the branch exists, returns
 * the existing branch name without error.
 */
export async function createReleaseBranch(
  opts: BranchOptions,
  version: string,
): Promise<CreateReleaseBranchResult> {
  const branch = `${opts.releaseBranchPrefix}${version}`;
  const summary = await opts.git.branch();

  if (summary.all.includes(branch) || summary.all.includes(`remotes/origin/${branch}`)) {
    return { branch, alreadyExisted: true };
  }

  await opts.git.checkout(opts.mainBranch);
  await opts.git.pull('origin', opts.mainBranch);
  await opts.git.checkoutBranch(branch, opts.mainBranch);

  return { branch, alreadyExisted: false };
}

/**
 * Sync the develop branch with main, resolving package.json version conflicts
 * by taking the develop-branch version (so develop always moves forward).
 */
export async function syncDevelop(opts: BranchOptions): Promise<{ conflicts: string[] }> {
  await opts.git.checkout(opts.developBranch);
  await opts.git.pull('origin', opts.developBranch);

  const mergeResult = await opts.git.merge([opts.mainBranch, '--no-ff', '--no-commit']).catch(() => null);

  const status = await opts.git.status();
  const conflicted = status.conflicted;

  // Auto-resolve package.json conflicts by keeping the develop version
  const pkgConflicts = conflicted.filter(f => f === 'package.json');
  for (const file of pkgConflicts) {
    await opts.git.checkout(['--ours', file]);
    await opts.git.add(file);
  }

  const unresolved = conflicted.filter(f => f !== 'package.json');

  if (unresolved.length === 0 && (mergeResult !== null || pkgConflicts.length > 0)) {
    await opts.git.commit(`chore: sync develop with ${opts.mainBranch}`);
  }

  return { conflicts: unresolved };
}

/**
 * Start a hotfix branch off main. Idempotent: if the branch exists, returns it.
 */
export async function hotfixStart(
  opts: BranchOptions,
  version: string,
): Promise<CreateReleaseBranchResult> {
  const branch = `${opts.hotfixBranchPrefix}${version}`;
  const summary = await opts.git.branch();

  if (summary.all.includes(branch) || summary.all.includes(`remotes/origin/${branch}`)) {
    return { branch, alreadyExisted: true };
  }

  await opts.git.checkout(opts.mainBranch);
  await opts.git.pull('origin', opts.mainBranch);
  await opts.git.checkoutBranch(branch, opts.mainBranch);

  return { branch, alreadyExisted: false };
}

/**
 * Finish a hotfix: merge the hotfix branch into main, develop, and any active
 * release branches. Returns the list of branches the hotfix was merged into.
 */
export async function hotfixFinish(
  opts: BranchOptions,
  version: string,
): Promise<{ mergedInto: string[] }> {
  const branch = `${opts.hotfixBranchPrefix}${version}`;
  const mergedInto: string[] = [];

  const summary = await opts.git.branch();
  const allBranches = summary.all.map(b => b.replace('remotes/origin/', ''));

  const activeReleaseBranches = [...new Set(allBranches)].filter(b =>
    b.startsWith(opts.releaseBranchPrefix),
  );

  const targets = [opts.mainBranch, opts.developBranch, ...activeReleaseBranches];

  for (const target of targets) {
    const exists = allBranches.includes(target);
    if (!exists) continue;

    await opts.git.checkout(target);
    await opts.git.pull('origin', target).catch(() => null);

    const result = await opts.git.merge([branch, '--no-ff']).catch((e: Error) => e);
    if (result instanceof Error) {
      throw new Error(`Merge of ${branch} into ${target} failed: ${result.message}`);
    }
    mergedInto.push(target);
  }

  return { mergedInto };
}

/**
 * List all active release branches (branches matching the release prefix).
 */
export async function listReleaseBranches(opts: BranchOptions): Promise<string[]> {
  const summary = await opts.git.branch(['-a']);
  const seen = new Set<string>();
  const results: string[] = [];

  for (const b of summary.all) {
    const name = b.replace('remotes/origin/', '').trim();
    if (name.startsWith(opts.releaseBranchPrefix) && !seen.has(name)) {
      seen.add(name);
      results.push(name);
    }
  }

  return results;
}
