import { GateResult, GateStage, GateStatus, RiskLevel, TicketId } from '../types';

export interface GatePolicy {
  requireHITL: boolean;
  requireQA: boolean;
  autoMergeOnGreenCI: boolean;
}

export const POLICIES: Record<RiskLevel, GatePolicy> = {
  low: { requireHITL: false, requireQA: false, autoMergeOnGreenCI: true },
  medium: { requireHITL: false, requireQA: true, autoMergeOnGreenCI: false },
  high: { requireHITL: true, requireQA: true, autoMergeOnGreenCI: false },
};

export function stagesForPolicy(policy: GatePolicy): GateStage[] {
  const stages: GateStage[] = ['scope', 'ci'];
  if (policy.requireQA) stages.push('qa');
  if (policy.requireHITL) stages.push('hitl');
  return stages;
}

export function createGateResult(
  stage: GateStage,
  status: GateStatus,
  opts: { message?: string; reviewerId?: string } = {},
): GateResult {
  return { stage, status, message: opts.message, reviewerId: opts.reviewerId, timestamp: new Date() };
}

export interface GatePipeline {
  ticketId: TicketId;
  riskLevel: RiskLevel;
  results: GateResult[];
}

export function isGreenForMerge(pipeline: GatePipeline): boolean {
  const policy = POLICIES[pipeline.riskLevel];
  const required = stagesForPolicy(policy);
  return required.every((stage) =>
    pipeline.results.some((r) => r.stage === stage && r.status === 'passed'),
  );
}
