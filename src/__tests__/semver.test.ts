import { describe, it, expect } from 'vitest';
import {
  parseSemVer,
  formatVersion,
  bump,
  compareVersions,
  isValidSemVer,
  nextReleaseVersion,
} from '../release/semver';

describe('parseSemVer', () => {
  it('parses a plain version string', () => {
    expect(parseSemVer('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it('strips the v prefix', () => {
    expect(parseSemVer('v2.0.1')).toEqual({ major: 2, minor: 0, patch: 1 });
  });

  it('throws on invalid input', () => {
    expect(() => parseSemVer('not-a-version')).toThrow();
  });
});

describe('formatVersion', () => {
  it('formats a SemVer object', () => {
    expect(formatVersion({ major: 1, minor: 2, patch: 3 })).toBe('1.2.3');
  });
});

describe('bump', () => {
  it('bumps patch', () => {
    expect(bump('1.2.3', 'patch')).toBe('1.2.4');
  });

  it('bumps minor and resets patch', () => {
    expect(bump('1.2.3', 'minor')).toBe('1.3.0');
  });

  it('bumps major and resets minor/patch', () => {
    expect(bump('1.2.3', 'major')).toBe('2.0.0');
  });

  it('strips v prefix', () => {
    expect(bump('v1.2.3', 'patch')).toBe('1.2.4');
  });
});

describe('compareVersions', () => {
  it('returns 0 for equal versions', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('returns positive when a > b', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
  });

  it('returns negative when a < b', () => {
    expect(compareVersions('0.9.0', '1.0.0')).toBeLessThan(0);
  });
});

describe('isValidSemVer', () => {
  it('accepts valid versions', () => {
    expect(isValidSemVer('1.0.0')).toBe(true);
    expect(isValidSemVer('v2.3.4')).toBe(true);
  });

  it('rejects invalid strings', () => {
    expect(isValidSemVer('foo')).toBe(false);
    expect(isValidSemVer('')).toBe(false);
  });
});

describe('nextReleaseVersion', () => {
  it('returns 1.0.0 when no tag exists', () => {
    expect(nextReleaseVersion(null)).toBe('1.0.0');
  });

  it('bumps minor by default', () => {
    expect(nextReleaseVersion('v1.2.3')).toBe('1.3.0');
  });

  it('respects the requested bump type', () => {
    expect(nextReleaseVersion('v1.2.3', 'patch')).toBe('1.2.4');
    expect(nextReleaseVersion('v1.2.3', 'major')).toBe('2.0.0');
  });
});
