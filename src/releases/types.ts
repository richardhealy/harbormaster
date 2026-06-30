/** Lifecycle stage of a release: `planning` → `in_progress` → optional `frozen` → `released`, or `cancelled` at any point. */
export type ReleaseStatus = 'planning' | 'in_progress' | 'frozen' | 'released' | 'cancelled'

/** A Linear ticket as captured in a release manifest — a flattened, storage-friendly projection of {@link LinearTicket}. */
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

/** Snapshot of everything shipping in a release, generated from Linear at {@link ReleaseManager.buildManifest} time. */
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

/** A release row as persisted in Postgres. */
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

/** Inputs to {@link ReleaseManager.create}; `version` is passed separately since it's usually derived via {@link bumpFromLatestTag}. */
export interface CreateReleaseOptions {
  branch: string
  linearCycleId?: string
  freezeAt?: Date
}
