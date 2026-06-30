export type ReleaseStatus = 'planning' | 'in_progress' | 'frozen' | 'released' | 'cancelled'

export interface ManifestTicket {
  id: string
  identifier: string
  title: string
  description?: string
  status: string
  priority: number
  labels: string[]
  assignee?: string
  url?: string
}

export interface ReleaseManifest {
  releaseId: string
  version: string
  generatedAt: string
  linearCycleId?: string
  tickets: ManifestTicket[]
  summary: {
    total: number
    byStatus: Record<string, number>
    byPriority: Record<number, number>
  }
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
  branch: string
  linearCycleId?: string
  freezeAt?: Date
}
