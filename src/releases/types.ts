/**
 * Lifecycle state of a release. `frozen` is entered via {@link ReleaseManager.setFreezeWindow}
 * once a freeze cutoff is set, and `released` is entered via
 * {@link ReleaseManager.updateStatus}, which also stamps `releasedAt`.
 */
export type ReleaseStatus = 'planning' | 'in_progress' | 'frozen' | 'released' | 'cancelled'

/**
 * A single Linear ticket as captured into a release manifest. This is a
 * point-in-time projection of the ticket's relevant fields, not a live
 * reference — it stays accurate even if the underlying Linear issue later
 * changes.
 */
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

/**
 * The on-the-record snapshot of what's shipping in a release: the set of
 * Linear tickets included, plus rollup counts. Built by
 * {@link ReleaseManager.buildManifest} and persisted to the release row,
 * this is what ties a release back to ticketed work per the provenance
 * requirement — every release should be traceable to the tickets it shipped.
 */
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

/** A release as persisted in the database. */
export interface ReleaseRecord {
  id: string
  version: string
  branch: string
  status: ReleaseStatus
  linearCycleId?: string
  manifest?: ReleaseManifest
  notes?: string
  /** Cutoff after which no more tickets are planned into this release. */
  freezeAt?: Date
  /** Set automatically when status transitions to `'released'`. */
  releasedAt?: Date
  createdAt: Date
  updatedAt: Date
}

/** Options accepted by {@link ReleaseManager.create} when planning a new release. */
export interface CreateReleaseOptions {
  branch: string
  linearCycleId?: string
  freezeAt?: Date
}
