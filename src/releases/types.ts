import type { LinearTicket } from '../integrations/linear/types'
import type { LinearIssueFilter } from '../integrations/linear/types'

export type ReleaseStatus = 'planning' | 'frozen' | 'released' | 'cancelled'

export interface ReleaseManifestEntry {
  ticketId: string
  identifier: string
  title: string
  labels: string[]
  priority: number
  assigneeId?: string
  url?: string
  dispatchId?: string
  mergedAt?: string
}

export interface ReleaseManifest {
  version: string
  entries: ReleaseManifestEntry[]
  generatedAt: string
}

export interface Release {
  id: string
  version: string
  branch: string
  status: ReleaseStatus
  linearCycleId?: string
  manifest?: ReleaseManifest
  notes?: string
  freezeAt?: Date
  releasedAt?: Date
  createdAt: Date
  updatedAt: Date
}

export interface CreateReleaseOptions {
  version: string
  branch: string
  linearCycleId?: string
  freezeAt?: Date
}

export interface UpdateReleaseOptions {
  status?: ReleaseStatus
  manifest?: ReleaseManifest
  notes?: string
  freezeAt?: Date
  releasedAt?: Date
}

export interface ReleasePlan {
  version: string
  branch: string
  linearCycleId?: string
  tickets: LinearTicket[]
  manifest: ReleaseManifest
  notes: string
}

export interface FreezeWindowResult {
  frozen: boolean
  releaseId?: string
  version?: string
  freezeAt?: Date
}

export interface ReleasesPool {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}

export interface ReleaseNotesOptions {
  groupByLabel?: boolean
  includeAssignee?: boolean
  includeUrl?: boolean
}

export type { LinearIssueFilter }
