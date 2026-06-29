import { describe, it, expect } from 'vitest'
import {
  formatTag,
  stripTagPrefix,
  planTagMain,
  buildTagMessage,
} from '../../src/release/tag.js'

describe('formatTag', () => {
  it('prepends v prefix', () => {
    expect(formatTag('1.2.3')).toBe('v1.2.3')
  })

  it('is idempotent when v already present', () => {
    expect(formatTag('v1.2.3')).toBe('v1.2.3')
  })
})

describe('stripTagPrefix', () => {
  it('strips v prefix', () => {
    expect(stripTagPrefix('v1.2.3')).toBe('1.2.3')
  })

  it('is a no-op when no prefix', () => {
    expect(stripTagPrefix('1.2.3')).toBe('1.2.3')
  })
})

describe('planTagMain', () => {
  it('plans to tag when no guards fire', async () => {
    const guards = {
      tagExists: async () => false,
      hasPostReleaseRun: async () => false,
    }
    const plan = await planTagMain('1.2.3', guards)
    expect(plan.tag).toBe('v1.2.3')
    expect(plan.skip).toBe(false)
  })

  it('skips when tag already exists (idempotency guard)', async () => {
    const guards = {
      tagExists: async () => true,
      hasPostReleaseRun: async () => false,
    }
    const plan = await planTagMain('1.2.3', guards)
    expect(plan.skip).toBe(true)
    expect(plan.reason).toContain('already exists')
  })

  it('skips when post-release already ran', async () => {
    const guards = {
      tagExists: async () => false,
      hasPostReleaseRun: async () => true,
    }
    const plan = await planTagMain('1.2.3', guards)
    expect(plan.skip).toBe(true)
    expect(plan.reason).toContain('post-release')
  })
})

describe('buildTagMessage', () => {
  it('builds a plain tag message', () => {
    expect(buildTagMessage('1.2.3')).toBe('Release v1.2.3')
  })

  it('appends notes when provided', () => {
    const msg = buildTagMessage('1.2.3', 'Bug fixes')
    expect(msg).toBe('Release v1.2.3\n\nBug fixes')
  })
})
