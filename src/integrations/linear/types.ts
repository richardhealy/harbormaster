export interface LinearTicket {
  id: string;
  title: string;
  status: string;
  assignee?: string;
  labels: string[];
  branchName?: string;
  cycleId?: string;
}

export interface LinearCycle {
  id: string;
  name: string;
  number: number;
  startsAt?: string;
  endsAt?: string;
  issueIds: string[];
}
