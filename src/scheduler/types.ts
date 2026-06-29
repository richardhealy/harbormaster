export interface TicketRef {
  id: string;
  linearId: string;
  title: string;
  impactPaths: string[];
  priority: number;
}

export type DispatchAction = "parallel" | "sequence" | "merge";

export interface DispatchPlan {
  id: string;
  ticketIds: string[];
  action: DispatchAction;
  reason: string;
  impactScore: number;
}

export interface SchedulerResult {
  plans: DispatchPlan[];
  /** Tickets that could not be scheduled due to hotspot leases or other blocks */
  blocked: Array<{ ticketId: string; reason: string }>;
}
