/**
 * Public surface of the gate pipeline: scope → CI → QA → HITL checks that
 * gate a change before merge, with per-domain risk policy controlling which
 * stages apply and how strict each one is.
 */
export type {
  RiskLevel,
  DomainPolicy,
  GateStage,
  GateStatus,
  GateResult,
  GatePipelineInput,
  GatePipelineResult,
  ScopeCheckResult,
  CICheckFn,
  QACheckFn,
  ApprovalFn,
} from './types'
export { DEFAULT_POLICY, resolvePolicy } from './policy'
export { ScopeChecker } from './scope'
export { GatePipeline, createGatePipeline } from './pipeline'
export type { GatePipelineOptions } from './pipeline'
