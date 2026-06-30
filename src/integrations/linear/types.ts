/** A Linear workflow state as attached to a ticket (e.g. `{ name: 'In Progress', type: 'started' }`). */
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

/** A normalised Linear issue — `labels` is always a flat array, never the raw GraphQL connection shape. */
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

/** One state in a team's workflow (Triage, Backlog, In Progress, Done, ...). */
export interface LinearWorkflowState {
  id: string
  name: string
  type: string
  color: string
}

/** Subset of Linear's `IssueFilter` GraphQL input used by {@link LinearClient.listTeamIssues}. */
export interface LinearIssueFilter {
  state?: { type?: { eq: string } }
  label?: { name?: { in: string[] } }
}
