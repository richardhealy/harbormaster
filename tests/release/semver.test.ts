import { bumpVersion, inferBumpType, versionSlug, parseVersion } from '../../src/release/semver';

describe('bumpVersion', () => {
  it('bumps patch', () => expect(bumpVersion('1.2.3', 'patch')).toBe('1.2.4'));
  it('bumps minor', () => expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0'));
  it('bumps major', () => expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0'));
  it('strips v prefix', () => expect(bumpVersion('v1.2.3', 'patch')).toBe('1.2.4'));
  it('throws on invalid version', () => expect(() => bumpVersion('not-a-version', 'patch')).toThrow());
});

describe('inferBumpType', () => {
  it('returns patch for fix commits', () => {
    expect(inferBumpType(['fix: resolve null pointer', 'chore: update deps'])).toBe('patch');
  });

  it('returns minor for feat commits', () => {
    expect(inferBumpType(['feat: add worktree support', 'fix: typo'])).toBe('minor');
  });

  it('returns major for breaking feat', () => {
    expect(inferBumpType(['feat!: redesign scheduler API'])).toBe('major');
  });

  it('returns major for BREAKING CHANGE in body', () => {
    expect(inferBumpType(['feat: something\nBREAKING CHANGE: removes old API'])).toBe('major');
  });

  it('returns patch for empty list', () => {
    expect(inferBumpType([])).toBe('patch');
  });
});

describe('versionSlug', () => {
  it('returns clean version string', () => expect(versionSlug('1.2.3')).toBe('1.2.3'));
  it('strips v prefix', () => expect(versionSlug('v1.2.3')).toBe('1.2.3'));
});

describe('parseVersion', () => {
  it('parses standard version', () => expect(parseVersion('1.2.3')).toBe('1.2.3'));
  it('parses v-prefixed version', () => expect(parseVersion('v2.0.0')).toBe('2.0.0'));
  it('throws on invalid', () => expect(() => parseVersion('invalid')).toThrow());
});
