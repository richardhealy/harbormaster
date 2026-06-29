import * as semver from 'semver';

export type BumpType = 'major' | 'minor' | 'patch';

export interface VersionInfo {
  current: string;
  next: string;
  bumpType: BumpType;
}

/**
 * Determine the next version by bumping `current` by the given type.
 * Strips any leading 'v' prefix before parsing, returns bare version string.
 */
export function bumpVersion(current: string, bumpType: BumpType): string {
  const clean = semver.clean(current);
  if (!clean) throw new Error(`Invalid semver: ${current}`);
  const next = semver.inc(clean, bumpType);
  if (!next) throw new Error(`Could not increment ${current} as ${bumpType}`);
  return next;
}

/**
 * Infer bump type from an array of conventional-commit subjects since the last tag.
 * - Any `feat!:` / `BREAKING CHANGE` → major
 * - Any `feat:` → minor
 * - Everything else → patch
 */
export function inferBumpType(commitMessages: string[]): BumpType {
  const hasBreaking = commitMessages.some(
    m => /^(feat|fix|refactor|chore)!:/i.test(m) || /BREAKING CHANGE/i.test(m),
  );
  if (hasBreaking) return 'major';

  const hasFeat = commitMessages.some(m => /^feat(\(.*?\))?:/i.test(m));
  if (hasFeat) return 'minor';

  return 'patch';
}

/**
 * Derive a branch-safe slug from a version string: "1.2.3" → "1.2.3".
 */
export function versionSlug(version: string): string {
  return semver.clean(version) ?? version.replace(/[^a-zA-Z0-9.-]/g, '-');
}

export function parseVersion(raw: string): string {
  const clean = semver.clean(raw);
  if (!clean) throw new Error(`Cannot parse version: ${raw}`);
  return clean;
}
