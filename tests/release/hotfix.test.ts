import { describe, it, expect } from 'vitest'
import { planHotfixStart, planHotfixFinish } from '../../src/release/hotfix.js'
import { DEFAULT_BRANCH_CONFIG } from '../../src/release/types.js'

describe('planHotfixStart', () => {
  it('bumps the latest tag patch version and plans the hotfix branch', () => {
    const plan = planHotfixStart('1.2.3')
    expect(plan.hotfixVersion).toBe('1.2.4')
    expect(plan.hotfixBranch).toBe('hotfix/1.2.4')
    expect(plan.hotfixTag).toBe('v1.2.4')
    expect(plan.baseBranch).toBe(DEFAULT_BRANCH_CONFIG.mainBranch)
  })
})

describe('planHotfixFinish', () => {
  it('fans out to main, develop, and active release branches', () => {
    const activeBranches = ['release/1.2', 'release/1.1', 'feature/something']
    const plan = planHotfixFinish('hotfix/1.2.4', activeBranches)
    expect(plan.mergeTargets).toContain('main')
    expect(plan.mergeTargets).toContain('develop')
    expect(plan.mergeTargets).toContain('release/1.2')
    expect(plan.mergeTargets).toContain('release/1.1')
    // feature branches should not be in merge targets
    expect(plan.mergeTargets).not.toContain('feature/something')
  })

  it('deduplicates merge targets', () => {
    const plan = planHotfixFinish('hotfix/1.2.4', ['release/1.2', 'main'])
    const unique = new Set(plan.mergeTargets)
    expect(unique.size).toBe(plan.mergeTargets.length)
  })

  it('includes the hotfix tag', () => {
    const plan = planHotfixFinish('hotfix/1.2.4', [])
    expect(plan.hotfixTag).toBe('v1.2.4')
  })
})
