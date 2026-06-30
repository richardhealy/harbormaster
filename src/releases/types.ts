import type { LinearTicket } from '../integrations/linear'

export type { LinearTicket }

export type ReleaseStatus = 'planning' | 'active' | 'frozen' | 'released' | 'abandoned'

export const PRIORITY_LABELS: Record<number, string> = {
  0: 'none',
  1: 'urgent',
  2: 'high',
  3: 'medium',
  4: 'low',
}

export interface ReleaseManifestEntry {
  ticketId: string
  identifier: string
  title: string
  state: string
  priority: number
  priorityLabel: string
  labels: string[]
  assignee?: string
  url?: string
}

export interface ReleaseManifest {
  version: string
  generatedAt: string
  totalTickets: number
  tickets: ReleaseManifestEntry[]
  byPriority: Record<string, ReleaseManifestEntry[]>
  byLabel: Record<string, ReleaseManifestEntry[]>
}

export interface CreateReleaseOptions {
  linearCycleId?: string
  freezeAt?: Date
}

export interface ReleaseRecord {
  id: string
  version: string
  branch: string
  status: ReleaseStatus
  linearCycleId: string | null
  manifest: ReleaseManifest | null
  notes: string | null
  freezeAt: Date | null
  releasedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface ManifestBuildOptions {
  /** Optional label name filter — only tickets with this label are included */
  labelFilter?: string
  /** Optional state type filter, e.g. 'completed' */
  stateTypeFilter?: string
}
