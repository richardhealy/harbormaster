import * as semver from 'semver';
import { SemverBumpType } from './types';

export function bumpVersion(current: string, type: SemverBumpType): string {
  const bumped = semver.inc(current, type);
  if (!bumped) throw new Error(`Cannot bump "${current}" as ${type}`);
  return bumped;
}

export function parseVersion(tag: string): string | null {
  const coerced = semver.coerce(tag);
  if (!coerced) return null;
  return semver.valid(coerced);
}

export function isValidVersion(version: string): boolean {
  return semver.valid(version) !== null;
}

export function compareVersions(a: string, b: string): number {
  return semver.compare(a, b);
}

export function sortVersionsDesc(versions: string[]): string[] {
  return [...versions].sort((a, b) => semver.rcompare(a, b));
}
