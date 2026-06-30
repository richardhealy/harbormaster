export type RiskLevel = 'low' | 'medium' | 'high'

export interface DomainPolicy {
  domain: string
  riskLevel: RiskLevel
  /** Maximum allowed ratio of unexpected/expected files before scope check fails */
  scopeDriftThreshold: number
  requiresQA: boolean
  requiresHITL: boolean
}

export type GateStage = 'scope' | 'ci' | 'qa' | 'hitl'
export type GateStatus = 'pass' | 'fail' | 'skipped'

export interface GateResult {
  stage: GateStage
  status: GateStatus
  reason?: string
  details?: Record<string, unknown>
}

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

export interface GatePipelineResult {
  dispatchId: string
  policy: DomainPolicy
  gates: GateResult[]
  /** True only when all required stages passed (or were skipped on low-risk policy) */
  passed: boolean
  /** Stage at which the pipeline was blocked, absent when passed is true */
  blockedAt?: GateStage
}

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

/** Injectable function types — keep gates testable without real infrastructure */
export type CICheckFn = (branch: string) => Promise<'success' | 'failure' | 'pending' | 'unknown'>
export type QACheckFn = (dispatchId: string, branch: string) => Promise<{ passed: boolean; reason?: string }>
export type ApprovalFn = (dispatchId: string, ticketId: string) => Promise<boolean>
