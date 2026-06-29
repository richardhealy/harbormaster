import {
  bumpVersion,
  parseVersion,
  isValidVersion,
  compareVersions,
  sortVersionsDesc,
} from '../../src/release/semver';

describe('bumpVersion', () => {
  test('bumps patch', () => {
    expect(bumpVersion('1.2.3', 'patch')).toBe('1.2.4');
  });

  test('bumps minor and resets patch', () => {
    expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0');
  });

  test('bumps major and resets minor and patch', () => {
    expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0');
  });

  test('throws for invalid version', () => {
    expect(() => bumpVersion('not-valid', 'patch')).toThrow();
  });
});

describe('parseVersion', () => {
  test('strips v prefix', () => {
    expect(parseVersion('v1.2.3')).toBe('1.2.3');
  });

  test('handles bare version', () => {
    expect(parseVersion('1.2.3')).toBe('1.2.3');
  });

  test('coerces partial versions', () => {
    expect(parseVersion('v2.1')).toBe('2.1.0');
  });

  test('returns null for non-version strings', () => {
    expect(parseVersion('not-a-version')).toBeNull();
  });
});

describe('isValidVersion', () => {
  test('accepts valid semver', () => {
    expect(isValidVersion('1.2.3')).toBe(true);
    expect(isValidVersion('0.0.1')).toBe(true);
    expect(isValidVersion('10.20.30')).toBe(true);
  });

  test('rejects invalid strings', () => {
    expect(isValidVersion('bad')).toBe(false);
    expect(isValidVersion('not-a-version')).toBe(false);
    expect(isValidVersion('')).toBe(false);
  });
});

describe('compareVersions', () => {
  test('lower < higher returns -1', () => {
    expect(compareVersions('1.2.3', '1.2.4')).toBe(-1);
  });

  test('equal returns 0', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  test('higher > lower returns 1', () => {
    expect(compareVersions('1.2.4', '1.2.3')).toBe(1);
  });

  test('compares across major versions', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
  });
});

describe('sortVersionsDesc', () => {
  test('sorts highest first', () => {
    const versions = ['1.0.0', '1.2.3', '1.1.0', '2.0.0'];
    expect(sortVersionsDesc(versions)).toEqual(['2.0.0', '1.2.3', '1.1.0', '1.0.0']);
  });

  test('does not mutate the input array', () => {
    const original = ['1.0.0', '2.0.0'];
    const sorted = sortVersionsDesc(original);
    expect(original).toEqual(['1.0.0', '2.0.0']);
    expect(sorted).toEqual(['2.0.0', '1.0.0']);
  });
});
