/**
 * The workflow state a ticket currently sits in, as embedded on a
 * `LinearTicket` (e.g. `{ name: "In Progress", type: "started" }`).
 */
export interface LinearState {
  id: string
  name: string
  type: string
}

/** A label attached to a Linear issue. */
export interface LinearLabel {
  id: string
  name: string
}

/** A Linear user, used for issue assignees. */
export interface LinearUser {
  id: string
  name: string
  email?: string
}

/**
 * Normalized representation of a Linear issue as used throughout
 * harbormaster — note `labels` is always a flat array here, unlike Linear's
 * raw GraphQL `{ nodes: [...] }` connection shape (see `normaliseTicket` in
 * `./index.ts`).
 */
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

/**
 * A workflow state available to a team (distinct from `LinearState`, which
 * is the state embedded on a specific ticket). Returned by
 * `LinearClient.getWorkflowStates` and used to resolve a status name to the
 * `stateId` required by `updateTicketStatus`.
 */
export interface LinearWorkflowState {
  id: string
  name: string
  type: string
  color: string
}

/**
 * Filter input accepted by `LinearClient.listTeamIssues`, mirroring (a
 * subset of) Linear's `IssueFilter` GraphQL input type.
 */
export interface LinearIssueFilter {
  state?: { type?: { eq: string } }
  label?: { name?: { in: string[] } }
}
