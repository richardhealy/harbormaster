/** Linear API domain types */

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
}

export interface LinearTicket {
  id: string
  identifier: string
  title: string
  state: LinearState
  priority: number
  labels: LinearLabel[]
  assignee?: LinearUser
}

export interface LinearWorkflowState {
  id: string
  name: string
  type: string
  teamId?: string
}

export interface LinearSyncResult {
  synced: number
  errors: string[]
}

/** Minimal fetch interface so the client is testable without real network calls */
export type FetchFn = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>
