import {
  bumpVersion,
  nextVersion,
  latestVersionFromTags,
  parseVersionFromTag,
  formatTag,
  releaseBranchName,
  isPreRelease,
} from '../../src/release/semver';

describe('bumpVersion', () => {
  it('bumps patch', () => expect(bumpVersion('1.2.3', 'patch')).toBe('1.2.4'));
  it('bumps minor', () => expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0'));
  it('bumps major', () => expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0'));
  it('throws on invalid version', () => expect(() => bumpVersion('invalid', 'patch')).toThrow());
});

describe('parseVersionFromTag', () => {
  it('strips v prefix', () => expect(parseVersionFromTag('v1.2.3')).toBe('1.2.3'));
  it('handles no prefix', () => expect(parseVersionFromTag('1.2.3', '')).toBe('1.2.3'));
  it('returns null for invalid', () => expect(parseVersionFromTag('invalid')).toBeNull());
});

describe('latestVersionFromTags', () => {
  it('returns highest semver tag', () => {
    const tags = ['v1.0.0', 'v1.2.0', 'v1.1.0', 'v0.9.0'];
    expect(latestVersionFromTags(tags)).toBe('1.2.0');
  });

  it('returns null for empty list', () => {
    expect(latestVersionFromTags([])).toBeNull();
  });

  it('ignores non-semver tags', () => {
    const tags = ['v1.0.0', 'latest', 'nightly'];
    expect(latestVersionFromTags(tags)).toBe('1.0.0');
  });
});

describe('nextVersion', () => {
  it('bumps from existing tags', () => {
    const tags = ['v1.0.0', 'v1.1.0'];
    expect(nextVersion(tags, 'patch')).toBe('1.1.1');
    expect(nextVersion(tags, 'minor')).toBe('1.2.0');
    expect(nextVersion(tags, 'major')).toBe('2.0.0');
  });

  it('starts from 0.0.0 when no tags', () => {
    expect(nextVersion([], 'minor')).toBe('0.1.0');
    expect(nextVersion([], 'major')).toBe('1.0.0');
    expect(nextVersion([], 'patch')).toBe('0.0.1');
  });
});

describe('formatTag', () => {
  it('adds v prefix by default', () => expect(formatTag('1.2.3')).toBe('v1.2.3'));
  it('uses custom prefix', () => expect(formatTag('1.2.3', 'release-')).toBe('release-1.2.3'));
});

describe('releaseBranchName', () => {
  it('creates major.minor branch', () => expect(releaseBranchName('1.2.3')).toBe('release/1.2'));
  it('uses custom prefix', () => expect(releaseBranchName('2.0.0', 'rel/')).toBe('rel/2.0'));
});

describe('isPreRelease', () => {
  it('detects pre-release versions', () => {
    expect(isPreRelease('1.0.0-alpha.1')).toBe(true);
    expect(isPreRelease('1.0.0-beta')).toBe(true);
    expect(isPreRelease('1.0.0-rc.1')).toBe(true);
  });

  it('returns false for stable versions', () => {
    expect(isPreRelease('1.0.0')).toBe(false);
    expect(isPreRelease('2.3.4')).toBe(false);
  });
});
