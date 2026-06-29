import * as semver from 'semver';

export type BumpType = 'major' | 'minor' | 'patch' | 'prerelease';

export interface SemverResult {
  previous: string;
  next: string;
  bumpType: BumpType;
}

export function bumpVersion(current: string, type: BumpType, preId?: string): SemverResult {
  const parsed = semver.valid(current);
  if (!parsed) {
    throw new Error(`Invalid semver: ${current}`);
  }

  const next = preId ? semver.inc(parsed, type, preId) : semver.inc(parsed, type);
  if (!next) {
    throw new Error(`Could not bump ${current} as ${type}`);
  }

  return { previous: parsed, next, bumpType: type };
}

export function inferBumpType(commitMessages: string[]): BumpType {
  const hasBreaking = commitMessages.some(
    (m) => /^[a-z]+(\(.+\))?!:/.test(m) || m.includes('BREAKING CHANGE')
  );
  if (hasBreaking) return 'major';

  const hasFeature = commitMessages.some((m) => /^feat(\(.+\))?:/.test(m));
  if (hasFeature) return 'minor';

  return 'patch';
}

export function parseVersion(tag: string): string | null {
  const v = tag.startsWith('v') ? tag.slice(1) : tag;
  return semver.valid(v);
}

export function compareVersions(a: string, b: string): number {
  return semver.compare(a, b);
}

export function isValidVersion(version: string): boolean {
  return semver.valid(version) !== null;
}

export function formatTag(version: string): string {
  return version.startsWith('v') ? version : `v${version}`;
}
