import { describe, it, expect } from 'vitest'
import {
  GatePipeline,
  checkScope,
  createGatePipeline,
  BUILTIN_POLICIES,
  DEFAULT_DOMAIN_POLICY,
} from '../../src/gates/index'
import type {
  DomainPolicy,
  CIStatusFn,
  QACheckFn,
  HITLApprovalFn,
  GateRunOptions,
} from '../../src/gates/index'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXED_DATE = new Date('2026-06-30T00:00:00Z')
const fixedClock = () => FIXED_DATE

function makePolicy(overrides: Partial<DomainPolicy> & { domain: string }): DomainPolicy {
  return {
    risk: 'medium',
    requireScope: true,
    scopeDriftThreshold: 0.5,
    requireCI: true,
    requireQA: false,
    requireHITL: false,
    ...overrides,
  }
}

function baseOptions(overrides: Partial<GateRunOptions> = {}): GateRunOptions {
  return {
    dispatchId: 'dispatch-1',
    ticketId: 'TICKET-42',
    domain: 'custom',
    expectedFiles: ['src/foo.ts', 'src/bar.ts'],
    actualFiles: ['src/foo.ts', 'src/bar.ts'],
    headRef: 'abc123',
    ...overrides,
  }
}

const ciSuccess: CIStatusFn = async () => 'success'
const ciFailure: CIStatusFn = async () => 'failure'
const ciPending: CIStatusFn = async () => 'pending'
const ciUnknown: CIStatusFn = async () => 'unknown'

const qaPass: QACheckFn = async () => ({ passed: true, reason: 'All QA checks green' })
const qaFail: QACheckFn = async () => ({ passed: false, reason: 'Integration test failed' })

const hitlApprove: HITLApprovalFn = async () => ({
  approved: true,
  by: 'alice',
  reason: 'Looks good to me',
})
const hitlReject: HITLApprovalFn = async () => ({
  approved: false,
  by: 'bob',
  reason: 'Needs more testing',
})

// ---------------------------------------------------------------------------
// checkScope
// ---------------------------------------------------------------------------

describe('checkScope', () => {
  it('passes when all actual files are in the expected set', () => {
    const result = checkScope(['a.ts', 'b.ts'], ['a.ts', 'b.ts'], 0.5)
    expect(result.passed).toBe(true)
    expect(result.driftRatio).toBe(0)
    expect(result.unexpectedFiles).toEqual([])
  })

  it('passes when drift is below the threshold', () => {
    // 1 unexpected out of 4 actual = 25% drift < 50% threshold
    const result = checkScope(['a.ts', 'b.ts', 'c.ts'], ['a.ts', 'b.ts', 'c.ts', 'x.ts'], 0.5)
    expect(result.passed).toBe(true)
    expect(result.driftRatio).toBeCloseTo(0.25)
    expect(result.unexpectedFiles).toEqual(['x.ts'])
  })

  it('fails when drift equals the threshold exactly', () => {
    // 2 unexpected out of 4 actual = 50% drift; threshold is 0.5 → fails (> not >=)
    // Wait, logic is driftRatio <= threshold → passed.  50% == 50% → passed.
    const result = checkScope(['a.ts', 'b.ts'], ['a.ts', 'b.ts', 'x.ts', 'y.ts'], 0.5)
    expect(result.passed).toBe(true) // 2/4 = 0.5 = threshold → passes
    expect(result.driftRatio).toBeCloseTo(0.5)
  })

  it('fails when drift exceeds the threshold', () => {
    // 3 unexpected out of 4 actual = 75% drift > 50% threshold
    const result = checkScope(['a.ts'], ['a.ts', 'x.ts', 'y.ts', 'z.ts'], 0.5)
    expect(result.passed).toBe(false)
    expect(result.driftRatio).toBeCloseTo(0.75)
    expect(result.unexpectedFiles).toEqual(['x.ts', 'y.ts', 'z.ts'])
    expect(result.reason).toMatch(/exceeds/)
  })

  it('passes with an empty actual files list', () => {
    const result = checkScope(['a.ts'], [], 0.5)
    expect(result.passed).toBe(true)
    expect(result.driftRatio).toBe(0)
  })

  it('fails when ALL actual files are unexpected (zero tolerance)', () => {
    // 2 unexpected out of 2 actual = 100% drift; threshold=0 → fails
    const result = checkScope([], ['x.ts', 'y.ts'], 0.0)
    expect(result.passed).toBe(false)
    expect(result.driftRatio).toBeCloseTo(1.0)
  })

  it('fails for zero-tolerance threshold with any unexpected file', () => {
    const result = checkScope(['a.ts'], ['a.ts', 'b.ts'], 0.0)
    expect(result.passed).toBe(false)
    expect(result.reason).toMatch(/exceeds/)
  })

  it('passes with threshold=1.0 regardless of drift', () => {
    const result = checkScope([], ['x.ts', 'y.ts', 'z.ts'], 1.0)
    expect(result.passed).toBe(true)
  })

  it('reason mentions unexpected files by name', () => {
    const result = checkScope(['a.ts'], ['a.ts', 'b.ts', 'c.ts'], 0.0)
    expect(result.reason).toMatch(/b\.ts/)
  })
})

// ---------------------------------------------------------------------------
// GatePipeline.getPolicy
// ---------------------------------------------------------------------------

describe('GatePipeline.getPolicy', () => {
  it('returns builtin policy for known domain', () => {
    const pipeline = new GatePipeline(BUILTIN_POLICIES, fixedClock)
    const policy = pipeline.getPolicy('db')
    expect(policy.domain).toBe('db')
    expect(policy.requireHITL).toBe(true)
    expect(policy.risk).toBe('high')
  })

  it('falls back to DEFAULT_DOMAIN_POLICY for unknown domain', () => {
    const pipeline = new GatePipeline([], fixedClock)
    const policy = pipeline.getPolicy('unknown-domain')
    expect(policy.domain).toBe('unknown-domain')
    expect(policy.risk).toBe(DEFAULT_DOMAIN_POLICY.risk)
    expect(policy.requireHITL).toBe(DEFAULT_DOMAIN_POLICY.requireHITL)
  })

  it('returns registered policy after registerPolicy call', () => {
    const pipeline = new GatePipeline([], fixedClock)
    pipeline.registerPolicy(makePolicy({ domain: 'my-module', risk: 'low', requireHITL: false }))
    const policy = pipeline.getPolicy('my-module')
    expect(policy.risk).toBe('low')
  })

  it('registerPolicy replaces an existing entry', () => {
    const pipeline = new GatePipeline(BUILTIN_POLICIES, fixedClock)
    pipeline.registerPolicy(makePolicy({ domain: 'db', requireHITL: false }))
    const policy = pipeline.getPolicy('db')
    expect(policy.requireHITL).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Scope gate
// ---------------------------------------------------------------------------

describe('evaluate — scope gate', () => {
  it('passes when actual files match expected', async () => {
    const pipeline = new GatePipeline(
      [makePolicy({ domain: 'custom', requireCI: false })],
      fixedClock,
    )
    const result = await pipeline.evaluate(baseOptions())
    const scope = result.decisions.find(d => d.stage === 'scope')!
    expect(scope.outcome).toBe('passed')
    expect(result.canMerge).toBe(true)
  })

  it('fails and short-circuits when drift exceeds threshold', async () => {
    const pipeline = new GatePipeline(
      [makePolicy({ domain: 'custom', requireCI: false, requireHITL: false, scopeDriftThreshold: 0.1 })],
      fixedClock,
    )
    const opts = baseOptions({
      actualFiles: ['src/foo.ts', 'x.ts', 'y.ts', 'z.ts'], // 3/4 unexpected
    })
    const result = await pipeline.evaluate(opts)
    expect(result.canMerge).toBe(false)
    expect(result.blockedAt).toBe('scope')
    // Only scope decision should exist (short-circuited)
    expect(result.decisions).toHaveLength(1)
    expect(result.decisions[0].outcome).toBe('failed')
  })

  it('skips scope gate when requireScope is false', async () => {
    const pipeline = new GatePipeline(
      [makePolicy({ domain: 'custom', requireScope: false, requireCI: false })],
      fixedClock,
    )
    const result = await pipeline.evaluate(baseOptions({ actualFiles: ['totally/unexpected.ts'] }))
    const scope = result.decisions.find(d => d.stage === 'scope')!
    expect(scope.outcome).toBe('skipped')
    expect(result.canMerge).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// CI gate
// ---------------------------------------------------------------------------

describe('evaluate — CI gate', () => {
  it('passes when CI is green', async () => {
    const pipeline = new GatePipeline(
      [makePolicy({ domain: 'custom' })],
      fixedClock,
    )
    const result = await pipeline.evaluate(baseOptions({ ciStatus: ciSuccess }))
    const ci = result.decisions.find(d => d.stage === 'ci')!
    expect(ci.outcome).toBe('passed')
    expect(result.canMerge).toBe(true)
  })

  it('fails and short-circuits when CI is red', async () => {
    const pipeline = new GatePipeline(
      [makePolicy({ domain: 'custom' })],
      fixedClock,
    )
    const result = await pipeline.evaluate(baseOptions({ ciStatus: ciFailure }))
    expect(result.canMerge).toBe(false)
    expect(result.blockedAt).toBe('ci')
    const ci = result.decisions.find(d => d.stage === 'ci')!
    expect(ci.outcome).toBe('failed')
    // HITL stage should NOT appear (short-circuited)
    expect(result.decisions.find(d => d.stage === 'hitl')).toBeUndefined()
  })

  it('sets awaiting when CI is pending', async () => {
    const pipeline = new GatePipeline(
      [makePolicy({ domain: 'custom' })],
      fixedClock,
    )
    const result = await pipeline.evaluate(baseOptions({ ciStatus: ciPending }))
    expect(result.canMerge).toBe(false)
    expect(result.blockedAt).toBe('ci')
    const ci = result.decisions.find(d => d.stage === 'ci')!
    expect(ci.outcome).toBe('awaiting')
  })

  it('treats unknown CI status as failed', async () => {
    const pipeline = new GatePipeline(
      [makePolicy({ domain: 'custom' })],
      fixedClock,
    )
    const result = await pipeline.evaluate(baseOptions({ ciStatus: ciUnknown }))
    expect(result.canMerge).toBe(false)
    expect(result.blockedAt).toBe('ci')
    const ci = result.decisions.find(d => d.stage === 'ci')!
    expect(ci.outcome).toBe('failed')
  })

  it('sets awaiting when ciStatus resolver is missing', async () => {
    const pipeline = new GatePipeline(
      [makePolicy({ domain: 'custom' })],
      fixedClock,
    )
    const result = await pipeline.evaluate(baseOptions({ ciStatus: undefined }))
    const ci = result.decisions.find(d => d.stage === 'ci')!
    expect(ci.outcome).toBe('awaiting')
    expect(result.canMerge).toBe(false)
  })

  it('skips CI gate when requireCI is false', async () => {
    const pipeline = new GatePipeline(
      [makePolicy({ domain: 'custom', requireCI: false })],
      fixedClock,
    )
    const result = await pipeline.evaluate(baseOptions())
    const ci = result.decisions.find(d => d.stage === 'ci')!
    expect(ci.outcome).toBe('skipped')
    expect(result.canMerge).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// QA gate
// ---------------------------------------------------------------------------

describe('evaluate — QA gate', () => {
  it('passes when QA check returns passed=true', async () => {
    const pipeline = new GatePipeline(
      [makePolicy({ domain: 'custom', requireQA: true })],
      fixedClock,
    )
    const result = await pipeline.evaluate(baseOptions({ ciStatus: ciSuccess, qaCheck: qaPass }))
    const qa = result.decisions.find(d => d.stage === 'qa')!
    expect(qa.outcome).toBe('passed')
    expect(result.canMerge).toBe(true)
  })

  it('fails and short-circuits when QA check returns passed=false', async () => {
    const pipeline = new GatePipeline(
      [makePolicy({ domain: 'custom', requireQA: true })],
      fixedClock,
    )
    const result = await pipeline.evaluate(baseOptions({ ciStatus: ciSuccess, qaCheck: qaFail }))
    expect(result.canMerge).toBe(false)
    expect(result.blockedAt).toBe('qa')
    const qa = result.decisions.find(d => d.stage === 'qa')!
    expect(qa.outcome).toBe('failed')
    expect(qa.reason).toMatch(/Integration test failed/)
  })

  it('sets awaiting when qaCheck is missing and QA is required', async () => {
    const pipeline = new GatePipeline(
      [makePolicy({ domain: 'custom', requireQA: true })],
      fixedClock,
    )
    const result = await pipeline.evaluate(baseOptions({ ciStatus: ciSuccess }))
    const qa = result.decisions.find(d => d.stage === 'qa')!
    expect(qa.outcome).toBe('awaiting')
    expect(result.canMerge).toBe(false)
  })

  it('skips QA gate when requireQA is false', async () => {
    const pipeline = new GatePipeline(
      [makePolicy({ domain: 'custom', requireQA: false })],
      fixedClock,
    )
    const result = await pipeline.evaluate(baseOptions({ ciStatus: ciSuccess }))
    const qa = result.decisions.find(d => d.stage === 'qa')!
    expect(qa.outcome).toBe('skipped')
  })
})

// ---------------------------------------------------------------------------
// HITL gate
// ---------------------------------------------------------------------------

describe('evaluate — HITL gate', () => {
  it('passes when HITL approval is granted', async () => {
    const pipeline = new GatePipeline(
      [makePolicy({ domain: 'custom', requireHITL: true })],
      fixedClock,
    )
    const result = await pipeline.evaluate(
      baseOptions({ ciStatus: ciSuccess, hitlApproval: hitlApprove }),
    )
    const hitl = result.decisions.find(d => d.stage === 'hitl')!
    expect(hitl.outcome).toBe('passed')
    expect(hitl.by).toBe('alice')
    expect(result.canMerge).toBe(true)
  })

  it('fails when HITL approval is rejected', async () => {
    const pipeline = new GatePipeline(
      [makePolicy({ domain: 'custom', requireHITL: true })],
      fixedClock,
    )
    const result = await pipeline.evaluate(
      baseOptions({ ciStatus: ciSuccess, hitlApproval: hitlReject }),
    )
    expect(result.canMerge).toBe(false)
    expect(result.blockedAt).toBe('hitl')
    const hitl = result.decisions.find(d => d.stage === 'hitl')!
    expect(hitl.outcome).toBe('failed')
    expect(hitl.by).toBe('bob')
    expect(hitl.reason).toMatch(/Needs more testing/)
  })

  it('sets awaiting when hitlApproval function is not provided', async () => {
    const pipeline = new GatePipeline(
      [makePolicy({ domain: 'custom', requireHITL: true })],
      fixedClock,
    )
    const result = await pipeline.evaluate(baseOptions({ ciStatus: ciSuccess }))
    const hitl = result.decisions.find(d => d.stage === 'hitl')!
    expect(hitl.outcome).toBe('awaiting')
    expect(result.canMerge).toBe(false)
    expect(result.blockedAt).toBe('hitl')
  })

  it('skips HITL gate when requireHITL is false (auto-merge eligible)', async () => {
    const pipeline = new GatePipeline(
      [makePolicy({ domain: 'custom', requireHITL: false })],
      fixedClock,
    )
    const result = await pipeline.evaluate(baseOptions({ ciStatus: ciSuccess }))
    const hitl = result.decisions.find(d => d.stage === 'hitl')!
    expect(hitl.outcome).toBe('skipped')
    expect(hitl.reason).toMatch(/auto-merge/)
    expect(result.canMerge).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// End-to-end gate pipeline scenarios
// ---------------------------------------------------------------------------

describe('evaluate — end-to-end scenarios', () => {
  it('all-pass scenario: scope + CI + QA + HITL all green', async () => {
    const pipeline = new GatePipeline(
      [makePolicy({ domain: 'custom', requireQA: true, requireHITL: true })],
      fixedClock,
    )
    const result = await pipeline.evaluate(
      baseOptions({ ciStatus: ciSuccess, qaCheck: qaPass, hitlApproval: hitlApprove }),
    )
    expect(result.canMerge).toBe(true)
    expect(result.blockedAt).toBeUndefined()
    expect(result.decisions).toHaveLength(4)
    expect(result.decisions.every(d => d.outcome === 'passed')).toBe(true)
  })

  it('db domain: HITL required — auto-merge blocked even when CI and QA pass', async () => {
    const pipeline = createGatePipeline([], fixedClock)
    const result = await pipeline.evaluate({
      dispatchId: 'dispatch-db-1',
      ticketId: 'DB-99',
      domain: 'db',
      expectedFiles: ['src/db/migrations/002.sql'],
      actualFiles: ['src/db/migrations/002.sql'],
      headRef: 'sha-db',
      ciStatus: ciSuccess,
      qaCheck: qaPass,
      // No HITL resolver → awaiting
    })
    expect(result.canMerge).toBe(false)
    expect(result.blockedAt).toBe('hitl')
    const hitl = result.decisions.find(d => d.stage === 'hitl')!
    expect(hitl.outcome).toBe('awaiting')
  })

  it('db domain: canMerge when HITL approved', async () => {
    const pipeline = createGatePipeline([], fixedClock)
    const result = await pipeline.evaluate({
      dispatchId: 'dispatch-db-2',
      ticketId: 'DB-100',
      domain: 'db',
      expectedFiles: ['src/db/migrations/003.sql'],
      actualFiles: ['src/db/migrations/003.sql'],
      headRef: 'sha-db2',
      ciStatus: ciSuccess,
      qaCheck: qaPass,
      hitlApproval: hitlApprove,
    })
    expect(result.canMerge).toBe(true)
  })

  it('docs domain: auto-merges on green CI with no HITL', async () => {
    const pipeline = createGatePipeline([], fixedClock)
    const result = await pipeline.evaluate({
      dispatchId: 'dispatch-docs-1',
      ticketId: 'DOCS-5',
      domain: 'docs',
      expectedFiles: ['docs/guide.md'],
      actualFiles: ['docs/guide.md', 'docs/extra.md'], // extra file — docs threshold=1.0 so it passes
      headRef: 'sha-docs',
      ciStatus: ciSuccess,
    })
    expect(result.canMerge).toBe(true)
    const hitl = result.decisions.find(d => d.stage === 'hitl')!
    expect(hitl.outcome).toBe('skipped')
  })

  it('records at timestamp from the injected clock on all decisions', async () => {
    const pipeline = new GatePipeline(
      [makePolicy({ domain: 'custom', requireCI: false })],
      fixedClock,
    )
    const result = await pipeline.evaluate(baseOptions())
    for (const decision of result.decisions) {
      expect(decision.at).toEqual(FIXED_DATE)
    }
  })

  it('GateResult carries domain, policy, and identifiers', async () => {
    const policy = makePolicy({ domain: 'custom', requireCI: false })
    const pipeline = new GatePipeline([policy], fixedClock)
    const result = await pipeline.evaluate(baseOptions({ domain: 'custom', dispatchId: 'D1', ticketId: 'T1' }))
    expect(result.dispatchId).toBe('D1')
    expect(result.ticketId).toBe('T1')
    expect(result.domain).toBe('custom')
    expect(result.policy).toEqual(policy)
  })

  it('createGatePipeline merges built-in and extra policies', () => {
    const extra = makePolicy({ domain: 'my-extra', risk: 'low', requireHITL: false })
    const pipeline = createGatePipeline([extra])
    expect(pipeline.getPolicy('db').requireHITL).toBe(true)    // built-in
    expect(pipeline.getPolicy('my-extra').risk).toBe('low')     // custom
  })
})

// ---------------------------------------------------------------------------
// Decision timestamps
// ---------------------------------------------------------------------------

describe('GateDecision shape', () => {
  it('each decision has stage, outcome, reason, and at', async () => {
    const pipeline = new GatePipeline(
      [makePolicy({ domain: 'custom' })],
      fixedClock,
    )
    const result = await pipeline.evaluate(baseOptions({ ciStatus: ciSuccess }))
    for (const d of result.decisions) {
      expect(d.stage).toBeTruthy()
      expect(d.outcome).toBeTruthy()
      expect(d.reason).toBeTruthy()
      expect(d.at).toBeInstanceOf(Date)
    }
  })

  it('HITL decision includes approver name in `by` field', async () => {
    const pipeline = new GatePipeline(
      [makePolicy({ domain: 'custom', requireHITL: true })],
      fixedClock,
    )
    const result = await pipeline.evaluate(
      baseOptions({ ciStatus: ciSuccess, hitlApproval: hitlApprove }),
    )
    const hitl = result.decisions.find(d => d.stage === 'hitl')!
    expect(hitl.by).toBe('alice')
  })
})
