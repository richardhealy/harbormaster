import { describe, it, expect, vi } from 'vitest'
import {
  resolvePolicy,
  DEFAULT_POLICY,
  ScopeChecker,
  createGatePipeline,
} from '../../src/gates/index'
import type { GatePipelineInput } from '../../src/gates/index'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<GatePipelineInput> = {}): GatePipelineInput {
  return {
    dispatchId: 'dispatch-1',
    ticketId: 'TICKET-42',
    branch: 'feat/TICKET-42/add-feature',
    domains: ['release'],
    expectedFiles: ['src/release/branch.ts'],
    actualFiles: ['src/release/branch.ts'],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// resolvePolicy
// ---------------------------------------------------------------------------

describe('resolvePolicy', () => {
  it('returns default medium-risk policy for an unknown domain', () => {
    const p = resolvePolicy(['unknown-domain'])
    expect(p.riskLevel).toBe('medium')
    expect(p).toBe(DEFAULT_POLICY)
  })

  it('returns default policy for an empty domain list', () => {
    expect(resolvePolicy([])).toBe(DEFAULT_POLICY)
  })

  it('returns low-risk policy for docs domain', () => {
    const p = resolvePolicy(['docs'])
    expect(p.riskLevel).toBe('low')
    expect(p.requiresQA).toBe(false)
    expect(p.requiresHITL).toBe(false)
  })

  it('returns high-risk policy for db domain', () => {
    const p = resolvePolicy(['db'])
    expect(p.riskLevel).toBe('high')
    expect(p.requiresHITL).toBe(true)
    expect(p.scopeDriftThreshold).toBe(0.2)
  })

  it('returns high-risk policy for hotspots domain', () => {
    const p = resolvePolicy(['hotspots'])
    expect(p.riskLevel).toBe('high')
    expect(p.requiresHITL).toBe(true)
  })

  it('returns high-risk policy for provenance domain', () => {
    const p = resolvePolicy(['provenance'])
    expect(p.riskLevel).toBe('high')
    expect(p.requiresHITL).toBe(true)
  })

  it('picks strictest policy when domains mix low and high risk', () => {
    const p = resolvePolicy(['docs', 'db'])
    expect(p.riskLevel).toBe('high')
    expect(p.domain).toBe('db')
  })

  it('picks strictest policy when domains mix low and medium risk', () => {
    const p = resolvePolicy(['docs', 'release'])
    expect(p.riskLevel).toBe('medium')
    expect(p.domain).toBe('release')
  })

  it('picks strictest policy when domains mix medium and high risk', () => {
    const p = resolvePolicy(['release', 'provenance'])
    expect(p.riskLevel).toBe('high')
  })

  it('does not downgrade when a repeated low-risk domain follows a higher-risk one', () => {
    const p = resolvePolicy(['db', 'docs', 'docs'])
    expect(p.riskLevel).toBe('high')
  })
})

// ---------------------------------------------------------------------------
// ScopeChecker
// ---------------------------------------------------------------------------

describe('ScopeChecker', () => {
  const checker = new ScopeChecker()

  it('passes when all actual files are in the expected set', () => {
    const result = checker.check(['a.ts', 'b.ts'], ['a.ts', 'b.ts'], 0.5)
    expect(result.passed).toBe(true)
    expect(result.unexpectedFiles).toHaveLength(0)
    expect(result.driftRatio).toBe(0)
  })

  it('passes when actual files are a subset of expected', () => {
    const result = checker.check(['a.ts', 'b.ts', 'c.ts'], ['a.ts'], 0.5)
    expect(result.passed).toBe(true)
    expect(result.unexpectedFiles).toHaveLength(0)
    expect(result.driftRatio).toBe(0)
  })

  it('passes when drift is below the threshold', () => {
    // 1 unexpected out of 4 expected = 0.25 ratio, below 0.5 threshold
    const result = checker.check(['a.ts', 'b.ts', 'c.ts', 'd.ts'], ['a.ts', 'b.ts', 'e.ts'], 0.5)
    expect(result.passed).toBe(true)
    expect(result.driftRatio).toBe(0.25)
    expect(result.unexpectedFiles).toEqual(['e.ts'])
  })

  it('fails when drift exceeds the threshold', () => {
    // 2 unexpected out of 2 expected = 1.0 ratio, exceeds 0.5 threshold
    const result = checker.check(['a.ts', 'b.ts'], ['a.ts', 'c.ts', 'd.ts'], 0.5)
    expect(result.passed).toBe(false)
    expect(result.driftRatio).toBe(1.0)
    expect(result.unexpectedFiles).toEqual(['c.ts', 'd.ts'])
    expect(result.reason).toMatch(/100%/)
    expect(result.reason).toMatch(/50%/)
  })

  it('includes file names in the failure reason', () => {
    const result = checker.check(['a.ts'], ['a.ts', 'x.ts', 'y.ts'], 0.5)
    expect(result.reason).toContain('x.ts')
    expect(result.reason).toContain('y.ts')
  })

  it('truncates long file lists in the failure reason with ellipsis', () => {
    // 4 unexpected files triggers the slice(0,3) + ellipsis path
    const result = checker.check(['a.ts'], ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'], 0)
    expect(result.passed).toBe(false)
    expect(result.reason).toContain('…')
  })

  it('passes with driftRatio 0 when expectedFiles is empty', () => {
    const result = checker.check([], ['a.ts', 'b.ts'], 0.5)
    expect(result.passed).toBe(true)
    expect(result.driftRatio).toBe(0)
  })

  it('passes when both expected and actual are empty', () => {
    const result = checker.check([], [], 0.5)
    expect(result.passed).toBe(true)
    expect(result.driftRatio).toBe(0)
  })

  it('high-risk threshold (0.2) fails where medium (0.5) would pass', () => {
    // 1 unexpected / 4 expected = 0.25 — above 0.2, below 0.5
    const files = ['a.ts', 'b.ts', 'c.ts', 'd.ts']
    expect(checker.check(files, [...files, 'e.ts'], 0.5).passed).toBe(true)
    expect(checker.check(files, [...files, 'e.ts'], 0.2).passed).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// GatePipeline
// ---------------------------------------------------------------------------

const ciOk: () => Promise<'success'> = () => Promise.resolve('success')
const ciFail: () => Promise<'failure'> = () => Promise.resolve('failure')
const ciPending: () => Promise<'pending'> = () => Promise.resolve('pending')
const ciUnknown: () => Promise<'unknown'> = () => Promise.resolve('unknown')
const qaOk = async () => ({ passed: true })
const qaFail = async () => ({ passed: false, reason: 'eval score below threshold' })
const approveOk = async () => true
const approveReject = async () => false

describe('GatePipeline — low-risk domain (docs)', () => {
  it('passes with only scope and CI gates when policy is low-risk', async () => {
    const pipeline = createGatePipeline({ checkCI: ciOk })
    const result = await pipeline.run(makeInput({ domains: ['docs'] }))
    expect(result.passed).toBe(true)
    expect(result.policy.riskLevel).toBe('low')
    expect(result.gates.map(g => g.stage)).toEqual(['scope', 'ci'])
    expect(result.blockedAt).toBeUndefined()
  })

  it('blocks at scope when drift exceeds low-risk threshold', async () => {
    const pipeline = createGatePipeline({ checkCI: ciOk })
    const result = await pipeline.run(
      makeInput({
        domains: ['docs'],
        expectedFiles: ['README.md'],
        actualFiles: ['README.md', 'x.ts', 'y.ts', 'z.ts'],
      }),
    )
    expect(result.passed).toBe(false)
    expect(result.blockedAt).toBe('scope')
    expect(result.gates).toHaveLength(1)
  })

  it('blocks at CI when CI fails', async () => {
    const pipeline = createGatePipeline({ checkCI: ciFail })
    const result = await pipeline.run(makeInput({ domains: ['docs'] }))
    expect(result.passed).toBe(false)
    expect(result.blockedAt).toBe('ci')
    expect(result.gates).toHaveLength(2)
    expect(result.gates[1].reason).toContain('failure')
  })

  it('blocks at CI when CI is pending', async () => {
    const pipeline = createGatePipeline({ checkCI: ciPending })
    const result = await pipeline.run(makeInput({ domains: ['docs'] }))
    expect(result.passed).toBe(false)
    expect(result.blockedAt).toBe('ci')
  })

  it('blocks at CI when CI status is unknown', async () => {
    const pipeline = createGatePipeline({ checkCI: ciUnknown })
    const result = await pipeline.run(makeInput({ domains: ['docs'] }))
    expect(result.passed).toBe(false)
    expect(result.blockedAt).toBe('ci')
  })
})

describe('GatePipeline — medium-risk domain (release)', () => {
  it('passes all gates including QA when policy is medium-risk', async () => {
    const pipeline = createGatePipeline({ checkCI: ciOk, runQA: qaOk })
    const result = await pipeline.run(makeInput({ domains: ['release'] }))
    expect(result.passed).toBe(true)
    expect(result.policy.riskLevel).toBe('medium')
    expect(result.gates.map(g => g.stage)).toEqual(['scope', 'ci', 'qa'])
    expect(result.gates.every(g => g.status === 'pass')).toBe(true)
  })

  it('blocks at QA when QA runner rejects', async () => {
    const pipeline = createGatePipeline({ checkCI: ciOk, runQA: qaFail })
    const result = await pipeline.run(makeInput({ domains: ['release'] }))
    expect(result.passed).toBe(false)
    expect(result.blockedAt).toBe('qa')
    expect(result.gates[2].reason).toBe('eval score below threshold')
  })

  it('skips QA gate with skipped status when no QA runner is configured', async () => {
    const pipeline = createGatePipeline({ checkCI: ciOk })
    const result = await pipeline.run(makeInput({ domains: ['release'] }))
    expect(result.passed).toBe(true)
    const qaGate = result.gates.find(g => g.stage === 'qa')
    expect(qaGate?.status).toBe('skipped')
  })

  it('does not run HITL gate for medium-risk domain', async () => {
    const pipeline = createGatePipeline({ checkCI: ciOk, runQA: qaOk, approve: approveReject })
    const result = await pipeline.run(makeInput({ domains: ['release'] }))
    expect(result.passed).toBe(true)
    expect(result.gates.some(g => g.stage === 'hitl')).toBe(false)
  })

  it('blocks at CI before reaching QA', async () => {
    const pipeline = createGatePipeline({ checkCI: ciFail, runQA: vi.fn() as never })
    const result = await pipeline.run(makeInput({ domains: ['release'] }))
    expect(result.passed).toBe(false)
    expect(result.blockedAt).toBe('ci')
    expect(result.gates.some(g => g.stage === 'qa')).toBe(false)
  })
})

describe('GatePipeline — high-risk domain (db)', () => {
  it('passes all four gates when policy is high-risk', async () => {
    const pipeline = createGatePipeline({ checkCI: ciOk, runQA: qaOk, approve: approveOk })
    const result = await pipeline.run(makeInput({ domains: ['db'] }))
    expect(result.passed).toBe(true)
    expect(result.policy.riskLevel).toBe('high')
    expect(result.gates.map(g => g.stage)).toEqual(['scope', 'ci', 'qa', 'hitl'])
  })

  it('blocks at HITL when human reviewer rejects', async () => {
    const pipeline = createGatePipeline({ checkCI: ciOk, runQA: qaOk, approve: approveReject })
    const result = await pipeline.run(makeInput({ domains: ['db'] }))
    expect(result.passed).toBe(false)
    expect(result.blockedAt).toBe('hitl')
    expect(result.gates[3].reason).toBe('Human reviewer rejected the change')
  })

  it('skips HITL with skipped status when no approval function is configured', async () => {
    const pipeline = createGatePipeline({ checkCI: ciOk, runQA: qaOk })
    const result = await pipeline.run(makeInput({ domains: ['db'] }))
    expect(result.passed).toBe(true)
    const hitlGate = result.gates.find(g => g.stage === 'hitl')
    expect(hitlGate?.status).toBe('skipped')
  })

  it('enforces tighter scope threshold for high-risk domains', async () => {
    const pipeline = createGatePipeline({ checkCI: ciOk, runQA: qaOk, approve: approveOk })
    // 1 unexpected / 5 expected = 0.2; exactly at threshold, so passes
    const result = await pipeline.run(
      makeInput({
        domains: ['db'],
        expectedFiles: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'],
        actualFiles: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'],
      }),
    )
    // driftRatio 0.2 is NOT greater than threshold 0.2, so passes
    expect(result.gates[0].status).toBe('pass')
  })

  it('blocks at scope for high-risk domain when one extra file exceeds tight threshold', async () => {
    const pipeline = createGatePipeline({ checkCI: ciOk, runQA: qaOk, approve: approveOk })
    // 2 unexpected / 5 expected = 0.4 — above 0.2
    const result = await pipeline.run(
      makeInput({
        domains: ['db'],
        expectedFiles: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'],
        actualFiles: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts', 'g.ts'],
      }),
    )
    expect(result.passed).toBe(false)
    expect(result.blockedAt).toBe('scope')
  })

  it('does not call approve when QA already failed', async () => {
    const approve = vi.fn().mockResolvedValue(true)
    const pipeline = createGatePipeline({ checkCI: ciOk, runQA: qaFail, approve })
    const result = await pipeline.run(makeInput({ domains: ['db'] }))
    expect(result.passed).toBe(false)
    expect(result.blockedAt).toBe('qa')
    expect(approve).not.toHaveBeenCalled()
  })
})

describe('GatePipeline — mixed domains', () => {
  it('uses the strictest policy when domains include both docs and db', async () => {
    const pipeline = createGatePipeline({ checkCI: ciOk, runQA: qaOk, approve: approveOk })
    const result = await pipeline.run(makeInput({ domains: ['docs', 'db'] }))
    expect(result.policy.riskLevel).toBe('high')
    expect(result.gates.map(g => g.stage)).toEqual(['scope', 'ci', 'qa', 'hitl'])
    expect(result.passed).toBe(true)
  })

  it('includes dispatch id and policy in the result', async () => {
    const pipeline = createGatePipeline({ checkCI: ciOk })
    const result = await pipeline.run(makeInput({ dispatchId: 'disp-99', domains: ['docs'] }))
    expect(result.dispatchId).toBe('disp-99')
    expect(result.policy).toBeDefined()
  })
})
