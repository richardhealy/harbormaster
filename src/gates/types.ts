/** How much scrutiny a change should get, driven by the domain(s) it touches. */
export type RiskLevel = 'low' | 'medium' | 'high'

/**
 * The gating rules for a single domain: how much scope drift is tolerated
 * and which of the optional pipeline stages (QA, human approval) it must
 * pass. Higher-risk domains get tighter drift thresholds and more stages.
 */
export interface DomainPolicy {
  domain: string
  riskLevel: RiskLevel
  /** Maximum allowed ratio of unexpected/expected files before scope check fails */
  scopeDriftThreshold: number
  requiresQA: boolean
  requiresHITL: boolean
}

/** The four stages a change passes through, in order, before it can merge. */
export type GateStage = 'scope' | 'ci' | 'qa' | 'hitl'
/**
 * Outcome of a single gate stage. `'skipped'` is distinct from `'pass'`: it
 * means no runner was configured for an optional stage (e.g. no QA function
 * supplied), not that the stage was evaluated and succeeded.
 */
export type GateStatus = 'pass' | 'fail' | 'skipped'

/** Recorded outcome of one stage in a {@link GatePipelineResult}. */
export interface GateResult {
  stage: GateStage
  status: GateStatus
  reason?: string
  details?: Record<string, unknown>
}

/** Input to {@link GatePipeline.run} describing the change to be gated. */
export interface GatePipelineInput {
  dispatchId: string
  ticketId: string
  branch: string
  /** Domain names derived from the impact surface */
  domains: string[]
  /** Files the impact estimator predicted this ticket would touch */
  expectedFiles: string[]
  /** Files actually changed in the diff */
  actualFiles: string[]
  prNumber?: number
}

/** Final outcome of running a change through the gate pipeline. */
export interface GatePipelineResult {
  dispatchId: string
  policy: DomainPolicy
  gates: GateResult[]
  /** True only when all required stages passed (or were skipped on low-risk policy) */
  passed: boolean
  /** Stage at which the pipeline was blocked, absent when passed is true */
  blockedAt?: GateStage
}

/** Result of comparing actual diff files against the predicted impact surface. */
export interface ScopeCheckResult {
  passed: boolean
  expectedFiles: string[]
  actualFiles: string[]
  /** Files present in actualFiles but absent from expectedFiles */
  unexpectedFiles: string[]
  /**
   * unexpectedFiles.length / max(expectedFiles.length, 1).
   * Zero when expectedFiles is empty (confidence too low to enforce scope).
   */
  driftRatio: number
  reason?: string
}

/**
 * Injectable function types for the live-infrastructure-facing gate stages.
 * The pipeline never polls CI, runs QA, or pings a reviewer itself — the
 * caller supplies these callbacks instead, which keeps the pipeline
 * testable and matches the agent-iface design where the calling agent
 * reports observed status rather than the pipeline reaching out directly.
 */
export type CICheckFn = (branch: string) => Promise<'success' | 'failure' | 'pending' | 'unknown'>
/** Runs QA for a dispatch's branch and reports pass/fail with an optional reason. */
export type QACheckFn = (dispatchId: string, branch: string) => Promise<{ passed: boolean; reason?: string }>
/** Requests human-in-the-loop approval for a dispatch and reports the reviewer's decision. */
export type ApprovalFn = (dispatchId: string, ticketId: string) => Promise<boolean>
