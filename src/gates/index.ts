export type GateType = 'scope' | 'ci' | 'qa' | 'hitl';
export type GateStatus = 'pending' | 'passed' | 'failed' | 'waiting_approval';
export type DomainRisk = 'low' | 'medium' | 'high';

export interface GatePolicy {
  domain: string;
  risk: DomainRisk;
  requiredGates: GateType[];
  autoMergeOnGreen: boolean;
  hitlRequired: boolean;
}

export interface GateResult {
  gate: GateType;
  status: GateStatus;
  reason?: string;
  approvedBy?: string;
  approvedAt?: Date;
}

export interface GatePipelineResult {
  ticketId: string;
  policy: GatePolicy;
  results: GateResult[];
  overallStatus: GateStatus;
}

const DEFAULT_POLICIES: GatePolicy[] = [
  {
    domain: 'docs',
    risk: 'low',
    requiredGates: ['scope', 'ci'],
    autoMergeOnGreen: true,
    hitlRequired: false,
  },
  {
    domain: 'feature',
    risk: 'medium',
    requiredGates: ['scope', 'ci', 'qa'],
    autoMergeOnGreen: false,
    hitlRequired: false,
  },
  {
    domain: 'migration',
    risk: 'high',
    requiredGates: ['scope', 'ci', 'qa', 'hitl'],
    autoMergeOnGreen: false,
    hitlRequired: true,
  },
  {
    domain: 'security',
    risk: 'high',
    requiredGates: ['scope', 'ci', 'qa', 'hitl'],
    autoMergeOnGreen: false,
    hitlRequired: true,
  },
];

export function getPolicyForDomain(domain: string, customPolicies?: GatePolicy[]): GatePolicy {
  const policies = [...(customPolicies ?? []), ...DEFAULT_POLICIES];
  return (
    policies.find((p) => p.domain === domain) ??
    policies.find((p) => p.domain === 'feature')!
  );
}

export function evaluateScopeGate(
  expectedFiles: string[],
  actualFiles: string[],
  driftThreshold = 0.5
): GateResult {
  if (expectedFiles.length === 0) {
    return { gate: 'scope', status: 'passed', reason: 'No scope constraint specified' };
  }

  const expectedSet = new Set(expectedFiles);
  const unexpected = actualFiles.filter((f) => !expectedSet.has(f));
  const drift = unexpected.length / Math.max(actualFiles.length, 1);

  if (drift > driftThreshold) {
    return {
      gate: 'scope',
      status: 'failed',
      reason: `Diff drifted ${(drift * 100).toFixed(0)}% outside expected scope: ${unexpected.slice(0, 5).join(', ')}`,
    };
  }

  return { gate: 'scope', status: 'passed' };
}

export function evaluateCIGate(ciPassed: boolean, reason?: string): GateResult {
  return {
    gate: 'ci',
    status: ciPassed ? 'passed' : 'failed',
    reason: ciPassed ? undefined : (reason ?? 'CI check failed on the merged result'),
  };
}

export function requireHITLApproval(ticketId: string): GateResult {
  return {
    gate: 'hitl',
    status: 'waiting_approval',
    reason: `Waiting for human approval on ticket ${ticketId}`,
  };
}

export function recordHITLApproval(approvedBy: string): GateResult {
  return {
    gate: 'hitl',
    status: 'passed',
    approvedBy,
    approvedAt: new Date(),
  };
}

export function runGatePipeline(
  ticketId: string,
  policy: GatePolicy,
  gateResults: GateResult[]
): GatePipelineResult {
  const resultMap = new Map(gateResults.map((r) => [r.gate, r]));

  const allResults: GateResult[] = policy.requiredGates.map((gate) => {
    return resultMap.get(gate) ?? { gate, status: 'pending' as GateStatus };
  });

  let overallStatus: GateStatus = 'passed';
  for (const result of allResults) {
    if (result.status === 'failed') {
      overallStatus = 'failed';
      break;
    }
    if (result.status === 'waiting_approval') {
      overallStatus = 'waiting_approval';
      break;
    }
    if (result.status === 'pending') {
      overallStatus = 'pending';
    }
  }

  return { ticketId, policy, results: allResults, overallStatus };
}
