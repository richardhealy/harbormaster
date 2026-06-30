import type {
  ApprovalFn,
  CICheckFn,
  GatePipelineInput,
  GatePipelineResult,
  GateResult,
  GateStage,
  QACheckFn,
} from './types'
import { resolvePolicy } from './policy'
import { ScopeChecker } from './scope'

export interface GatePipelineOptions {
  checkCI: CICheckFn
  runQA?: QACheckFn
  approve?: ApprovalFn
  scopeChecker?: ScopeChecker
}

/**
 * Runs a change through the four-stage gate pipeline: scope → CI → QA → HITL.
 *
 * The stages that run and the strictness of each are determined by the domain
 * policy resolved from the input domains. The pipeline short-circuits on the
 * first failing stage so that downstream gates are never called unnecessarily.
 */
export class GatePipeline {
  private readonly scopeChecker: ScopeChecker
  private readonly checkCI: CICheckFn
  private readonly runQA?: QACheckFn
  private readonly approve?: ApprovalFn

  constructor(options: GatePipelineOptions) {
    this.scopeChecker = options.scopeChecker ?? new ScopeChecker()
    this.checkCI = options.checkCI
    this.runQA = options.runQA
    this.approve = options.approve
  }

  async run(input: GatePipelineInput): Promise<GatePipelineResult> {
    const policy = resolvePolicy(input.domains)
    const gates: GateResult[] = []

    const fail = (blockedAt: GateStage): GatePipelineResult => ({
      dispatchId: input.dispatchId,
      policy,
      gates,
      passed: false,
      blockedAt,
    })

    // ── Stage 1: Scope ───────────────────────────────────────────────────────
    const scopeCheck = this.scopeChecker.check(
      input.expectedFiles,
      input.actualFiles,
      policy.scopeDriftThreshold,
    )
    gates.push({
      stage: 'scope',
      status: scopeCheck.passed ? 'pass' : 'fail',
      reason: scopeCheck.reason,
      details: { driftRatio: scopeCheck.driftRatio, unexpectedFiles: scopeCheck.unexpectedFiles },
    })
    if (!scopeCheck.passed) return fail('scope')

    // ── Stage 2: CI ──────────────────────────────────────────────────────────
    const ciStatus = await this.checkCI(input.branch)
    gates.push({
      stage: 'ci',
      status: ciStatus === 'success' ? 'pass' : 'fail',
      reason: ciStatus !== 'success' ? `CI status: ${ciStatus}` : undefined,
      details: { ciStatus },
    })
    if (ciStatus !== 'success') return fail('ci')

    // ── Stage 3: QA ──────────────────────────────────────────────────────────
    if (policy.requiresQA) {
      if (!this.runQA) {
        gates.push({ stage: 'qa', status: 'skipped', reason: 'No QA runner configured' })
      } else {
        const qa = await this.runQA(input.dispatchId, input.branch)
        gates.push({
          stage: 'qa',
          status: qa.passed ? 'pass' : 'fail',
          reason: qa.reason,
        })
        if (!qa.passed) return fail('qa')
      }
    }

    // ── Stage 4: HITL ────────────────────────────────────────────────────────
    if (policy.requiresHITL) {
      if (!this.approve) {
        gates.push({ stage: 'hitl', status: 'skipped', reason: 'No approval function configured' })
      } else {
        const approved = await this.approve(input.dispatchId, input.ticketId)
        gates.push({
          stage: 'hitl',
          status: approved ? 'pass' : 'fail',
          reason: approved ? undefined : 'Human reviewer rejected the change',
        })
        if (!approved) return fail('hitl')
      }
    }

    return { dispatchId: input.dispatchId, policy, gates, passed: true }
  }
}

export function createGatePipeline(options: GatePipelineOptions): GatePipeline {
  return new GatePipeline(options)
}
