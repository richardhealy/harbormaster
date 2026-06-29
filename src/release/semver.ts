import semver from 'semver';
import { BumpType, SemVer } from './types';

export function parseSemVer(version: string): SemVer {
  const cleaned = semver.clean(version) ?? version.replace(/^v/, '');
  const parsed = semver.parse(cleaned);
  if (!parsed) {
    throw new Error(`Invalid semver: ${version}`);
  }
  return { major: parsed.major, minor: parsed.minor, patch: parsed.patch };
}

export function formatVersion(sv: SemVer): string {
  return `${sv.major}.${sv.minor}.${sv.patch}`;
}

export function bump(version: string, type: BumpType): string {
  const result = semver.inc(version.replace(/^v/, ''), type);
  if (!result) {
    throw new Error(`Cannot bump version: ${version}`);
  }
  return result;
}

export function compareVersions(a: string, b: string): number {
  return semver.compare(
    a.replace(/^v/, ''),
    b.replace(/^v/, ''),
  );
}

export function isValidSemVer(version: string): boolean {
  return semver.valid(version.replace(/^v/, '')) !== null;
}

export function nextReleaseVersion(latestTag: string | null, type: BumpType = 'minor'): string {
  if (!latestTag) {
    return '1.0.0';
  }
  return bump(latestTag, type);
}
