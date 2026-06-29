import { describe, it, expect } from 'vitest'
import {
  planSyncDevelop,
  resolvePackageJsonConflict,
  planAutoNextRelease,
} from '../../src/release/sync.js'

describe('planSyncDevelop', () => {
  it('marks as auto-resolvable when only package.json conflicts', () => {
    const plan = planSyncDevelop('release/1.2', ['package.json'])
    expect(plan.autoResolvable).toBe(true)
    expect(plan.sourceBranch).toBe('release/1.2')
    expect(plan.targetBranch).toBe('develop')
  })

  it('marks as not auto-resolvable when non-package.json conflicts exist', () => {
    const plan = planSyncDevelop('release/1.2', ['src/index.ts', 'package.json'])
    expect(plan.autoResolvable).toBe(false)
  })

  it('marks as not auto-resolvable for empty conflict list', () => {
    const plan = planSyncDevelop('release/1.2', [])
    expect(plan.autoResolvable).toBe(false)
  })
})

describe('resolvePackageJsonConflict', () => {
  it('takes the release branch content', () => {
    const release = '{"version":"1.2.1"}'
    const develop = '{"version":"1.2.0"}'
    expect(resolvePackageJsonConflict(release, develop)).toBe(release)
  })
})

describe('planAutoNextRelease', () => {
  it('plans the next release branch', () => {
    const plan = planAutoNextRelease('release/1.2', '1.3.0')
    expect(plan.nextVersion).toBe('1.3.0')
    expect(plan.newReleaseBranch).toBe('release/1.3.0')
  })
})
