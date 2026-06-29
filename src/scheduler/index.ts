export interface DispatchPlan {
  parallel: string[][];
  sequential: string[][];
  merged: Array<{ tickets: string[]; job: string }>;
}

export interface TicketImpact {
  ticketId: string;
  affectedPaths: string[];
  estimatedRisk: 'low' | 'medium' | 'high';
}
