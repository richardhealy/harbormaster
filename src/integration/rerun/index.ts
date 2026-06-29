export interface RerunRequest {
  ticketId: string;
  originalBranch: string;
  failureReason: 'rebase-conflict' | 'ci-failure' | 'gate-rejection';
  newBaseSha: string;
}

export interface RerunResult {
  ticketId: string;
  newBranch: string;
  status: 'dispatched' | 'failed';
}
