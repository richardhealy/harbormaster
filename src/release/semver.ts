import * as semver from 'semver';
import { SemverBump } from './types';

export function bumpVersion(current: string, bump: SemverBump): string {
  const next = semver.inc(current, bump);
  if (!next) throw new Error(`Cannot bump ${current} by ${bump}`);
  return next;
}

export function parseVersionFromTag(tag: string, prefix = 'v'): string | null {
  const stripped = tag.startsWith(prefix) ? tag.slice(prefix.length) : tag;
  return semver.valid(stripped);
}

export function latestVersionFromTags(tags: string[], prefix = 'v'): string | null {
  const versions = tags
    .map((t) => parseVersionFromTag(t, prefix))
    .filter((v): v is string => v !== null);

  if (versions.length === 0) return null;
  return versions.sort(semver.rcompare)[0];
}

export function nextVersion(tags: string[], bump: SemverBump, prefix = 'v'): string {
  const latest = latestVersionFromTags(tags, prefix);
  const current = latest ?? '0.0.0';
  return bumpVersion(current, bump);
}

export function formatTag(version: string, prefix = 'v'): string {
  return `${prefix}${version}`;
}

export function releaseBranchName(version: string, prefix = 'release/'): string {
  const [major, minor] = version.split('.');
  return `${prefix}${major}.${minor}`;
}

export function isPreRelease(version: string): boolean {
  return semver.prerelease(version) !== null;
}
