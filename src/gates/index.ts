import type {
  ClockFn,
  DomainPolicy,
  GateDecision,
  GateOutcome,
  GateResult,
  GateRunOptions,
  GateStage,
  ScopeCheckResult,
} from './types'
import { BUILTIN_POLICIES, DEFAULT_DOMAIN_POLICY } from './types'

export type {
  ClockFn,
  CIStatusFn,
  DomainPolicy,
  GateDecision,
  GateOutcome,
  GateResult,
  GateRunOptions,
  GateStage,
  QACheckFn,
  HITLApprovalFn,
  ScopeCheckResult,
} from './types'
export { BUILTIN_POLICIES, DEFAULT_DOMAIN_POLICY } from './types'

// ---------------------------------------------------------------------------
// Scope check (pure)
// ---------------------------------------------------------------------------

/**
 * Computes the scope drift between the estimated impact surface and the files
 * that actually changed.  A high drift ratio indicates the agent touched code
 * outside its declared scope.
 *
 * `driftRatio = unexpectedFiles.length / max(actualFiles.length, 1)`
 *
 * The gate passes when `driftRatio <= threshold`.
 */
export function checkScope(
  expectedFiles: string[],
  actualFiles: string[],
  threshold: number,
): ScopeCheckResult {
  const expectedSet = new Set(expectedFiles)
  const unexpectedFiles = actualFiles.filter(f => !expectedSet.has(f))
  const driftRatio = actualFiles.length === 0 ? 0 : unexpectedFiles.length / actualFiles.length
  const passed = driftRatio <= threshold

  const reason = passed
    ? `Scope drift ${(driftRatio * 100).toFixed(1)}% is within the ${(threshold * 100).toFixed(0)}% threshold`
    : `Scope drift ${(driftRatio * 100).toFixed(1)}% exceeds the ${(threshold * 100).toFixed(0)}% threshold — ${unexpectedFiles.length} unexpected file(s): ${unexpectedFiles.slice(0, 5).join(', ')}${unexpectedFiles.length > 5 ? '…' : ''}`

  return { passed, driftRatio, unexpectedFiles, reason }
}

// ---------------------------------------------------------------------------
// GatePipeline
// ---------------------------------------------------------------------------

/**
 * Evaluates changes through a configurable pipeline of gate stages —
 * scope drift, CI, QA, and HITL — using per-domain policies.
 *
 * Policies are registered via `registerPolicy` and looked up by the `domain`
 * field in `GateRunOptions`.  Unknown domains fall back to
 * `DEFAULT_DOMAIN_POLICY`.
 *
 * The pipeline is short-circuit: a `failed` stage prevents later stages from
 * running.  An `awaiting` stage (CI still pending, HITL not yet received) does
 * not short-circuit — the pipeline records the awaiting decision and continues
 * so the caller knows the full picture but `canMerge` will be false.
 */
export class GatePipeline {
  private readonly policies: Map<string, DomainPolicy> = new Map()

  constructor(
    policies: DomainPolicy[] = BUILTIN_POLICIES,
    private readonly clock: ClockFn = () => new Date(),
  ) {
    for (const p of policies) this.policies.set(p.domain, p)
  }

  /** Register or replace the policy for a domain. */
  registerPolicy(policy: DomainPolicy): void {
    this.policies.set(policy.domain, policy)
  }

  /** Retrieve the policy for a domain, falling back to the default. */
  getPolicy(domain: string): DomainPolicy {
    const stored = this.policies.get(domain)
    return stored ?? { domain, ...DEFAULT_DOMAIN_POLICY }
  }

  /**
   * Run all gate stages for a single dispatch in sequence.
   *
   * - Scope is always evaluated first; a `failed` scope gate short-circuits
   *   the remaining stages.
   * - CI, QA, and HITL run only when the scope gate did not fail.
   * - `canMerge` is true only when every required stage has `passed`.
   */
  async evaluate(options: GateRunOptions): Promise<GateResult> {
    const { dispatchId, ticketId, domain } = options
    const policy = this.getPolicy(domain)
    const decisions: GateDecision[] = []
    let blockedAt: GateStage | undefined

    const decide = (stage: GateStage, outcome: GateOutcome, reason: string, by?: string): void => {
      decisions.push({ stage, outcome, reason, at: this.clock(), by })
    }

    // ---- 1. Scope gate -------------------------------------------------------
    if (policy.requireScope) {
      const result = checkScope(options.expectedFiles, options.actualFiles, policy.scopeDriftThreshold)
      const outcome: GateOutcome = result.passed ? 'passed' : 'failed'
      decide('scope', outcome, result.reason)
      if (outcome === 'failed') {
        blockedAt = 'scope'
        // Short-circuit — remaining stages are meaningless if scope drifted badly.
        return this.buildResult(dispatchId, ticketId, domain, policy, decisions, blockedAt)
      }
    } else {
      decide('scope', 'skipped', 'Scope check not required by domain policy')
    }

    // ---- 2. CI gate ----------------------------------------------------------
    if (policy.requireCI) {
      if (!options.ciStatus) {
        // No CI resolver provided; treat as awaiting (caller should retry later).
        decide('ci', 'awaiting', 'CI status resolver not provided; cannot determine CI outcome')
        if (!blockedAt) blockedAt = 'ci'
      } else {
        const ciOutcome = await options.ciStatus(options.headRef)
        if (ciOutcome === 'success') {
          decide('ci', 'passed', 'CI is green on the rebased tip')
        } else if (ciOutcome === 'pending') {
          decide('ci', 'awaiting', 'CI is still running; re-evaluate when complete')
          if (!blockedAt) blockedAt = 'ci'
        } else {
          const reason = ciOutcome === 'failure'
            ? 'CI failed on the rebased tip — the change must not merge'
            : 'CI status is unknown; treating as failure'
          decide('ci', 'failed', reason)
          blockedAt = 'ci'
          return this.buildResult(dispatchId, ticketId, domain, policy, decisions, blockedAt)
        }
      }
    } else {
      decide('ci', 'skipped', 'CI gate not required by domain policy')
    }

    // ---- 3. QA gate ----------------------------------------------------------
    if (policy.requireQA) {
      if (!options.qaCheck) {
        decide('qa', 'awaiting', 'QA check function not provided; cannot evaluate QA gate')
        if (!blockedAt) blockedAt = 'qa'
      } else {
        const qa = await options.qaCheck(options.dispatchId)
        if (qa.passed) {
          decide('qa', 'passed', qa.reason)
        } else {
          decide('qa', 'failed', qa.reason)
          blockedAt = 'qa'
          return this.buildResult(dispatchId, ticketId, domain, policy, decisions, blockedAt)
        }
      }
    } else {
      decide('qa', 'skipped', 'QA gate not required by domain policy')
    }

    // ---- 4. HITL gate --------------------------------------------------------
    if (policy.requireHITL) {
      if (!options.hitlApproval) {
        decide('hitl', 'awaiting', 'No HITL resolver provided; change is waiting for human approval')
        if (!blockedAt) blockedAt = 'hitl'
      } else {
        const approval = await options.hitlApproval(options.dispatchId, options.ticketId)
        if (approval.approved) {
          decide('hitl', 'passed', approval.reason ?? `Approved by ${approval.by}`, approval.by)
        } else {
          decide('hitl', 'failed', approval.reason ?? `Rejected by ${approval.by}`, approval.by)
          blockedAt = 'hitl'
        }
      }
    } else {
      decide('hitl', 'skipped', 'HITL approval not required by domain policy (auto-merge eligible)')
    }

    return this.buildResult(dispatchId, ticketId, domain, policy, decisions, blockedAt)
  }

  private buildResult(
    dispatchId: string,
    ticketId: string,
    domain: string,
    policy: DomainPolicy,
    decisions: GateDecision[],
    blockedAt: GateStage | undefined,
  ): GateResult {
    const canMerge = blockedAt === undefined
    return { dispatchId, ticketId, domain, policy, decisions, canMerge, blockedAt }
  }
}

/** Factory: create a pipeline pre-loaded with built-in policies plus any extras. */
export function createGatePipeline(
  extraPolicies: DomainPolicy[] = [],
  clock?: ClockFn,
): GatePipeline {
  const all = [...BUILTIN_POLICIES, ...extraPolicies]
  return new GatePipeline(all, clock)
}
