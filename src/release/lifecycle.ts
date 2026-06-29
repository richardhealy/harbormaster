import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { bumpVersion, BumpType, formatTag, inferBumpType, parseVersion } from './semver';

export interface ReleaseContext {
  repoPath: string;
  defaultBranch: string;
  developBranch: string;
}

export interface BranchResult {
  branch: string;
  version: string;
  tag: string;
}

function git(cmd: string, cwd: string): string {
  return execSync(`git ${cmd}`, { cwd, encoding: 'utf8' }).trim();
}

function gitSafe(cmd: string, cwd: string): string | null {
  try {
    return git(cmd, cwd);
  } catch {
    return null;
  }
}

export function getLatestTag(ctx: ReleaseContext): string {
  const tag = gitSafe('describe --tags --abbrev=0', ctx.repoPath);
  if (!tag) return '0.0.0';
  const parsed = parseVersion(tag);
  return parsed ?? '0.0.0';
}

export function hasPostReleaseRun(ctx: ReleaseContext, version: string): boolean {
  const tag = formatTag(version);
  const commits = gitSafe(`log ${tag}..HEAD --oneline`, ctx.repoPath);
  return commits !== null && commits.trim().length > 0;
}

export function tagExists(ctx: ReleaseContext, tag: string): boolean {
  const result = gitSafe(`tag -l ${tag}`, ctx.repoPath);
  return result !== null && result.trim() === tag;
}

export function createReleaseBranch(
  ctx: ReleaseContext,
  bumpType: BumpType,
  preId?: string
): BranchResult {
  const currentVersion = getLatestTag(ctx);
  const { next } = bumpVersion(currentVersion, bumpType, preId);
  const branch = `release/${next}`;

  const existing = gitSafe(`branch --list ${branch}`, ctx.repoPath);
  if (existing && existing.trim()) {
    return { branch, version: next, tag: formatTag(next) };
  }

  git(`checkout ${ctx.defaultBranch}`, ctx.repoPath);
  git(`pull origin ${ctx.defaultBranch}`, ctx.repoPath);
  git(`checkout -b ${branch}`, ctx.repoPath);

  updatePackageVersion(ctx.repoPath, next);
  git('add package.json', ctx.repoPath);
  git(`commit -m "chore: bump version to ${next}"`, ctx.repoPath);

  return { branch, version: next, tag: formatTag(next) };
}

export function tagMain(ctx: ReleaseContext, version: string): string {
  const tag = formatTag(version);

  if (tagExists(ctx, tag)) {
    return tag;
  }

  if (!hasPostReleaseRun(ctx, version)) {
    throw new Error(`No commits after ${tag} — nothing to release`);
  }

  git(`checkout ${ctx.defaultBranch}`, ctx.repoPath);
  git(`tag -a ${tag} -m "Release ${version}"`, ctx.repoPath);

  return tag;
}

export interface HotfixResult {
  branch: string;
  version: string;
}

export function hotfixStart(ctx: ReleaseContext, description: string): HotfixResult {
  const currentVersion = getLatestTag(ctx);
  const { next } = bumpVersion(currentVersion, 'patch');
  const safeName = description.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  const branch = `hotfix/${next}-${safeName}`;

  git(`checkout ${ctx.defaultBranch}`, ctx.repoPath);
  git(`pull origin ${ctx.defaultBranch}`, ctx.repoPath);
  git(`checkout -b ${branch}`, ctx.repoPath);

  return { branch, version: next };
}

export interface HotfixFinishResult {
  mergedTo: string[];
  tag: string;
  version: string;
}

export function hotfixFinish(
  ctx: ReleaseContext,
  hotfixBranch: string,
  version: string,
  activeBranches: string[] = []
): HotfixFinishResult {
  const tag = formatTag(version);
  const mergedTo: string[] = [];

  const targets = [ctx.defaultBranch, ctx.developBranch, ...activeBranches];
  const unique = [...new Set(targets)];

  for (const target of unique) {
    const exists = gitSafe(`branch --list ${target}`, ctx.repoPath);
    if (!exists || !exists.trim()) continue;

    git(`checkout ${target}`, ctx.repoPath);
    git(`pull origin ${target}`, ctx.repoPath);
    git(`merge --no-ff ${hotfixBranch} -m "chore: merge hotfix ${version} into ${target}"`, ctx.repoPath);
    mergedTo.push(target);
  }

  git(`checkout ${ctx.defaultBranch}`, ctx.repoPath);
  if (!tagExists(ctx, tag)) {
    git(`tag -a ${tag} -m "Hotfix ${version}"`, ctx.repoPath);
  }

  return { mergedTo, tag, version };
}

export function syncDevelop(ctx: ReleaseContext): void {
  git(`checkout ${ctx.defaultBranch}`, ctx.repoPath);
  git(`pull origin ${ctx.defaultBranch}`, ctx.repoPath);
  git(`checkout ${ctx.developBranch}`, ctx.repoPath);
  git(`pull origin ${ctx.developBranch}`, ctx.repoPath);
  git(`merge ${ctx.defaultBranch} -m "chore: sync develop from ${ctx.defaultBranch}"`, ctx.repoPath);

  resolvePackageJsonConflict(ctx.repoPath, ctx.developBranch, ctx.defaultBranch);
}

export function featureBranchName(type: string, ticketId: string, description: string): string {
  const allowedTypes = ['feat', 'fix', 'chore', 'refactor', 'test', 'docs', 'perf', 'ci'];
  const normalizedType = allowedTypes.includes(type) ? type : 'feat';
  const safeName = description.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  return `${normalizedType}/${ticketId}-${safeName}`;
}

export function autoNextRelease(ctx: ReleaseContext, commitMessages: string[]): BranchResult {
  const bumpType = inferBumpType(commitMessages);
  return createReleaseBranch(ctx, bumpType);
}

function updatePackageVersion(repoPath: string, version: string): void {
  const pkgPath = path.join(repoPath, 'package.json');
  if (!fs.existsSync(pkgPath)) return;

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.version = version;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

function resolvePackageJsonConflict(
  repoPath: string,
  _currentBranch: string,
  sourceBranch: string
): void {
  const pkgPath = path.join(repoPath, 'package.json');
  if (!fs.existsSync(pkgPath)) return;

  const content = fs.readFileSync(pkgPath, 'utf8');
  if (!content.includes('<<<<<<<')) return;

  const sourceVersion = gitSafe(`show ${sourceBranch}:package.json`, repoPath);
  if (!sourceVersion) return;

  const sourcePkg = JSON.parse(sourceVersion);
  const devPkg = JSON.parse(
    content
      .replace(/<<<<<<< .*\n/gm, '')
      .replace(/=======\n[\s\S]*?>>>>>>> .*\n/gm, '')
  );

  devPkg.version = sourcePkg.version;
  fs.writeFileSync(pkgPath, JSON.stringify(devPkg, null, 2) + '\n');

  git('add package.json', repoPath);
  git('commit -m "chore: resolve package.json version conflict"', repoPath);
}
