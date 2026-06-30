export type ReleaseStatus = 'planning' | 'frozen' | 'releasing' | 'released' | 'cancelled'

export interface ManifestEntry {
  ticketId: string
  identifier: string
  title: string
  labels: string[]
  priority: number
  url?: string
}

export interface ReleaseManifest {
  version: string
  /** ISO-8601 timestamp of when the manifest was generated */
  generatedAt: string
  totalTickets: number
  entries: ManifestEntry[]
}

export interface ReleaseRecord {
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
  /** When supplied, the release is pre-scheduled to freeze at this time */
  freezeAt?: Date
}

export interface ReleasePool {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>
}
