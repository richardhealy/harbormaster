/** A release's lifecycle stage. `frozen` means past its freeze window — see {@link ReleaseManager.isInFreezeWindow}. */
export type ReleaseStatus = 'planning' | 'in_progress' | 'frozen' | 'released' | 'cancelled'

/** A Linear ticket as it appears in a generated release manifest — a flattened, release-facing projection of {@link LinearTicket}. */
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

/** The full set of tickets going into a release plus summary counts, as built by {@link ReleaseManager.buildManifest} and persisted to the release row. */
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

/** A row from the `releases` table. */
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

/** Options for {@link ReleaseManager.create}. */
export interface CreateReleaseOptions {
  branch: string
  linearCycleId?: string
  freezeAt?: Date
}
