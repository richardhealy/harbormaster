export type TicketId = string;
export type AgentId = string;
export type BranchName = string;
export type CommitSha = string;

export type TicketStatus =
  | 'pending'
  | 'dispatched'
  | 'in_progress'
  | 'integrating'
  | 'merged'
  | 'failed'
  | 'cancelled';

export type GateStage = 'scope' | 'ci' | 'qa' | 'hitl';
export type GateStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

export type RiskLevel = 'low' | 'medium' | 'high';

export type DispatchDecision = 'parallel' | 'sequential' | 'merged';

export interface Ticket {
  id: TicketId;
  linearId?: string;
  title: string;
  branch?: BranchName;
  agentId?: AgentId;
  status: TicketStatus;
  riskLevel: RiskLevel;
  impactSurface: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface DispatchPlan {
  decision: DispatchDecision;
  tickets: TicketId[];
  reason: string;
}

export interface GateResult {
  stage: GateStage;
  status: GateStatus;
  message?: string;
  reviewerId?: string;
  timestamp: Date;
}

export interface AuditEntry {
  id: string;
  ticketId?: TicketId;
  agentId?: AgentId;
  event: string;
  data: Record<string, unknown>;
  timestamp: Date;
}

export interface Release {
  id: string;
  version: string;
  branch: BranchName;
  linearReleaseId?: string;
  status: 'planning' | 'active' | 'frozen' | 'shipped';
  tickets: TicketId[];
  createdAt: Date;
  shippedAt?: Date;
}

export interface HotspotLease {
  id: string;
  path: string;
  ticketId: TicketId;
  agentId: AgentId;
  acquiredAt: Date;
  expiresAt: Date;
}
