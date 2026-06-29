import {
  bumpVersion,
  inferBumpType,
  parseVersion,
  formatTag,
  isValidVersion,
  compareVersions,
} from '../src/release/semver';

describe('bumpVersion', () => {
  it('bumps patch', () => {
    const result = bumpVersion('1.2.3', 'patch');
    expect(result).toEqual({ previous: '1.2.3', next: '1.2.4', bumpType: 'patch' });
  });

  it('bumps minor', () => {
    const result = bumpVersion('1.2.3', 'minor');
    expect(result).toEqual({ previous: '1.2.3', next: '1.3.0', bumpType: 'minor' });
  });

  it('bumps major', () => {
    const result = bumpVersion('1.2.3', 'major');
    expect(result).toEqual({ previous: '1.2.3', next: '2.0.0', bumpType: 'major' });
  });

  it('bumps prerelease with preId', () => {
    const result = bumpVersion('1.2.3', 'prerelease', 'beta');
    expect(result.next).toBe('1.2.4-beta.0');
  });

  it('throws on invalid version', () => {
    expect(() => bumpVersion('not-a-version', 'patch')).toThrow('Invalid semver');
  });
});

describe('inferBumpType', () => {
  it('returns major for breaking change (! syntax)', () => {
    expect(inferBumpType(['feat!: drop Node 16'])).toBe('major');
  });

  it('returns major for BREAKING CHANGE in body', () => {
    expect(inferBumpType(['feat: new API\n\nBREAKING CHANGE: old API removed'])).toBe('major');
  });

  it('returns minor for feat commit', () => {
    expect(inferBumpType(['feat: add scheduler', 'fix: typo'])).toBe('minor');
  });

  it('returns patch for fix only', () => {
    expect(inferBumpType(['fix: null pointer', 'chore: update deps'])).toBe('patch');
  });

  it('returns patch for empty list', () => {
    expect(inferBumpType([])).toBe('patch');
  });
});

describe('parseVersion', () => {
  it('strips v prefix', () => {
    expect(parseVersion('v1.2.3')).toBe('1.2.3');
  });

  it('accepts bare version', () => {
    expect(parseVersion('2.0.0')).toBe('2.0.0');
  });

  it('returns null for invalid', () => {
    expect(parseVersion('not-valid')).toBeNull();
  });
});

describe('formatTag', () => {
  it('adds v prefix if missing', () => {
    expect(formatTag('1.2.3')).toBe('v1.2.3');
  });

  it('does not double-add v prefix', () => {
    expect(formatTag('v1.2.3')).toBe('v1.2.3');
  });
});

describe('isValidVersion', () => {
  it('validates correct semver', () => {
    expect(isValidVersion('1.0.0')).toBe(true);
    expect(isValidVersion('1.0.0-alpha.1')).toBe(true);
  });

  it('rejects invalid strings', () => {
    expect(isValidVersion('not-semver')).toBe(false);
    expect(isValidVersion('')).toBe(false);
  });
});

describe('compareVersions', () => {
  it('orders versions correctly', () => {
    expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '1.0.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });
});
