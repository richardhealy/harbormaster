import { describe, it, expect } from 'vitest'
import {
  parseVersion,
  bumpVersion,
  nextPatchVersion,
  latestTag,
  compareVersions,
  formatBranchVersion,
  isPreRelease,
} from '../../src/release/semver.js'

describe('parseVersion', () => {
  it('parses a clean semver string', () => {
    const v = parseVersion('1.2.3')
    expect(v).toEqual({ major: 1, minor: 2, patch: 3, raw: '1.2.3' })
  })

  it('strips a leading v prefix', () => {
    const v = parseVersion('v2.0.0')
    expect(v.raw).toBe('2.0.0')
  })

  it('throws on invalid input', () => {
    expect(() => parseVersion('not-a-version')).toThrow()
  })
})

describe('bumpVersion', () => {
  it('bumps patch', () => {
    expect(bumpVersion('1.2.3', 'patch')).toBe('1.2.4')
  })

  it('bumps minor and resets patch', () => {
    expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0')
  })

  it('bumps major and resets minor and patch', () => {
    expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0')
  })
})

describe('nextPatchVersion', () => {
  it('returns 0.1.0 for empty tags', () => {
    expect(nextPatchVersion([])).toBe('0.1.0')
  })

  it('bumps the latest patch from a set of tags', () => {
    expect(nextPatchVersion(['v1.0.0', 'v1.0.1', 'v0.9.0'])).toBe('1.0.2')
  })

  it('handles tags without v prefix', () => {
    expect(nextPatchVersion(['1.5.3'])).toBe('1.5.4')
  })
})

describe('latestTag', () => {
  it('returns null for empty array', () => {
    expect(latestTag([])).toBeNull()
  })

  it('returns the highest semver', () => {
    expect(latestTag(['v0.1.0', 'v2.0.0', 'v1.9.9'])).toBe('2.0.0')
  })
})

describe('compareVersions', () => {
  it('returns 0 for equal versions', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
  })

  it('returns positive when first is greater', () => {
    expect(compareVersions('2.0.0', '1.0.0')).toBeGreaterThan(0)
  })

  it('returns negative when first is less', () => {
    expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0)
  })
})

describe('formatBranchVersion', () => {
  it('formats as major.minor', () => {
    expect(formatBranchVersion('1.2.3')).toBe('1.2')
  })
})

describe('isPreRelease', () => {
  it('returns false for stable versions', () => {
    expect(isPreRelease('1.0.0')).toBe(false)
  })

  it('returns true for pre-release versions', () => {
    expect(isPreRelease('1.0.0-alpha.1')).toBe(true)
  })
})
