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
