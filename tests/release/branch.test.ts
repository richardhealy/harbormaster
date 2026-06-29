import { describe, it, expect } from 'vitest'
import {
  releaseBranchName,
  hotfixBranchName,
  featureBranchName,
  parseFeatureBranch,
  planReleaseBranch,
  planHotfixBranch,
  isReleaseBranch,
  isHotfixBranch,
  extractVersionFromReleaseBranch,
} from '../../src/release/branch.js'
import { DEFAULT_BRANCH_CONFIG } from '../../src/release/types.js'

describe('releaseBranchName', () => {
  it('formats a release branch name from version', () => {
    expect(releaseBranchName('1.2.3')).toBe('release/1.2')
  })
})

describe('hotfixBranchName', () => {
  it('formats a hotfix branch name from version', () => {
    expect(hotfixBranchName('1.2.4')).toBe('hotfix/1.2.4')
  })
})

describe('featureBranchName', () => {
  it('formats a feature branch name', () => {
    expect(featureBranchName({ type: 'feat', ticketId: 'ENG-123', slug: 'add-scheduler' })).toBe(
      'feat/ENG-123-add-scheduler',
    )
  })

  it('omits slug when empty', () => {
    expect(featureBranchName({ type: 'fix', ticketId: 'ENG-456', slug: '' })).toBe(
      'fix/ENG-456',
    )
  })
})

describe('parseFeatureBranch', () => {
  it('parses a feature branch with slug', () => {
    const result = parseFeatureBranch('feat/ENG-123-add-scheduler')
    expect(result).toEqual({ type: 'feat', ticketId: 'ENG-123', slug: 'add-scheduler' })
  })

  it('parses a feature branch without slug', () => {
    const result = parseFeatureBranch('fix/ENG-456')
    expect(result).toEqual({ type: 'fix', ticketId: 'ENG-456', slug: '' })
  })

  it('returns null for non-feature branches', () => {
    expect(parseFeatureBranch('release/1.2')).toBeNull()
    expect(parseFeatureBranch('main')).toBeNull()
  })
})

describe('planReleaseBranch', () => {
  it('creates a release branch plan based off main', () => {
    const plan = planReleaseBranch('1.2.0')
    expect(plan.name).toBe('release/1.2')
    expect(plan.baseBranch).toBe(DEFAULT_BRANCH_CONFIG.mainBranch)
    expect(plan.type).toBe('release')
  })
})

describe('planHotfixBranch', () => {
  it('creates a hotfix branch plan based off main', () => {
    const plan = planHotfixBranch('1.2.1')
    expect(plan.name).toBe('hotfix/1.2.1')
    expect(plan.baseBranch).toBe(DEFAULT_BRANCH_CONFIG.mainBranch)
    expect(plan.type).toBe('hotfix')
  })
})

describe('isReleaseBranch', () => {
  it('identifies release branches', () => {
    expect(isReleaseBranch('release/1.2')).toBe(true)
    expect(isReleaseBranch('main')).toBe(false)
    expect(isReleaseBranch('hotfix/1.2.1')).toBe(false)
  })
})

describe('isHotfixBranch', () => {
  it('identifies hotfix branches', () => {
    expect(isHotfixBranch('hotfix/1.2.1')).toBe(true)
    expect(isHotfixBranch('release/1.2')).toBe(false)
    expect(isHotfixBranch('main')).toBe(false)
  })
})

describe('extractVersionFromReleaseBranch', () => {
  it('extracts version from a release branch name', () => {
    expect(extractVersionFromReleaseBranch('release/1.2')).toBe('1.2')
  })

  it('returns null for non-release branches', () => {
    expect(extractVersionFromReleaseBranch('main')).toBeNull()
  })
})
