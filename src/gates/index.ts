export type GateStatus = 'pending' | 'passed' | 'failed' | 'skipped';

export interface GateResult {
  gate: string;
  status: GateStatus;
  details?: string;
}

export interface GatePolicy {
  scopeCheck: boolean;
  ciRequired: boolean;
  qaRequired: boolean;
  hitlRequired: boolean;
}

export interface DomainPolicy {
  domain: string;
  riskLevel: 'low' | 'medium' | 'high';
  gates: GatePolicy;
}
