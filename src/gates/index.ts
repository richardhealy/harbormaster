/**
 * Public surface of the gate pipeline (spec section "The gate pipeline"):
 * scope, CI, QA, and HITL stages run in order per a per-domain {@link DomainPolicy},
 * short-circuiting on the first failure. See {@link GatePipeline} for the
 * orchestration and {@link resolvePolicy} for how a change's domains map to policy.
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
