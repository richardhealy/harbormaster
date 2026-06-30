/** A Linear workflow state as attached to an issue (not the team's full workflow — see {@link LinearWorkflowState}). */
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

/** Normalized shape of a Linear issue, as returned by {@link LinearClient} after `labels` has been flattened from the GraphQL connection. */
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

/** One state in a team's full workflow (e.g. "Todo", "In Progress"), as returned by `getWorkflowStates`. */
export interface LinearWorkflowState {
  id: string
  name: string
  type: string
  color: string
}

/** Subset of Linear's `IssueFilter` GraphQL input that harbormaster actually issues. */
export interface LinearIssueFilter {
  state?: { type?: { eq: string } }
  label?: { name?: { in: string[] } }
}
