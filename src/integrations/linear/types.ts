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

export interface LinearIssueFilter {
  state?: { type?: { eq: string } }
  label?: { name?: { in: string[] } }
}
