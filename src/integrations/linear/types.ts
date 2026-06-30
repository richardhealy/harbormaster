/** Shapes mirroring Linear's GraphQL API, trimmed to the fields harbormaster actually reads. */
export interface LinearState {
  id: string
  name: string
  type: string
}

export interface LinearLabel {
  id: string
  name: string
}

export interface LinearUser {
  id: string
  name: string
  email?: string
}

export interface LinearTicket {
  id: string
  identifier: string
  title: string
  description?: string
  state: LinearState
  priority: number
  labels: LinearLabel[]
  assignee?: LinearUser
  url?: string
  createdAt?: string
  updatedAt?: string
}

export interface LinearWorkflowState {
  id: string
  name: string
  type: string
  color: string
}

/** Subset of Linear's `IssueFilter` input type supported by {@link LinearClient.listTeamIssues}. */
export interface LinearIssueFilter {
  state?: { type?: { eq: string } }
  label?: { name?: { in: string[] } }
}
