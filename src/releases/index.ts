import type { Pool } from 'pg'
import type { LinearTicket } from '../integrations/linear/types'
import type {
  ManifestTicket,
  ReleaseManifest,
  ReleaseRecord,
  ReleaseStatus,
  CreateReleaseOptions,
} from './types'

export type { ManifestTicket, ReleaseManifest, ReleaseRecord, ReleaseStatus, CreateReleaseOptions }

export type ReleasesPool = Pick<Pool, 'query'>

/** Subset of {@link LinearClient} the release manager needs, kept narrow so tests can stub it without the full client. */
export interface ReleaseLinearClient {
  listTeamIssues(
    teamId: string,
    options?: {
      limit?: number
      filter?: { label?: { name?: { in: string[] } } }
    },
  ): Promise<LinearTicket[]>
}

interface DBRow {
  id: string
  version: string
  branch: string
  status: string
  linear_cycle_id: string | null
  manifest: ReleaseManifest | null
  notes: string | null
  freeze_at: Date | null
  released_at: Date | null
  created_at: Date
  updated_at: Date
}

function toRecord(row: DBRow): ReleaseRecord {
  return {
    id: row.id,
    version: row.version,
    branch: row.branch,
    status: row.status as ReleaseStatus,
    linearCycleId: row.linear_cycle_id ?? undefined,
    manifest: row.manifest ?? undefined,
    notes: row.notes ?? undefined,
    freezeAt: row.freeze_at ? new Date(row.freeze_at) : undefined,
    releasedAt: row.released_at ? new Date(row.released_at) : undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}

/**
 * Manages Linear-planned releases: creation, status transitions, freeze
 * windows, and manifest/notes generation from the tickets assigned to a
 * release. All database access goes through the injected {@link ReleasesPool}
 * so the manager is testable without a live Postgres instance.
 */
export class ReleaseManager {
  private readonly pool: ReleasesPool

  constructor(pool: ReleasesPool) {
    this.pool = pool
  }

  /** Inserts a new release in `planning` status. */
  async create(version: string, options: CreateReleaseOptions): Promise<ReleaseRecord> {
    const { branch, linearCycleId, freezeAt } = options
    const result = await this.pool.query<DBRow>(
      `INSERT INTO releases (version, branch, status, linear_cycle_id, freeze_at)
       VALUES ($1, $2, 'planning', $3, $4)
       RETURNING *`,
      [version, branch, linearCycleId ?? null, freezeAt ?? null],
    )
    return toRecord(result.rows[0])
  }

  /** Fetches one release by id, or `null` if it doesn't exist. */
  async getRelease(releaseId: string): Promise<ReleaseRecord | null> {
    const result = await this.pool.query<DBRow>('SELECT * FROM releases WHERE id = $1', [
      releaseId,
    ])
    return result.rows[0] ? toRecord(result.rows[0]) : null
  }

  /** Transitions a release's status; reaching `'released'` also stamps `released_at`. */
  async updateStatus(releaseId: string, status: ReleaseStatus): Promise<void> {
    const releasedClause = status === 'released' ? ', released_at = NOW()' : ''
    await this.pool.query(
      `UPDATE releases SET status = $1, updated_at = NOW()${releasedClause} WHERE id = $2`,
      [status, releaseId],
    )
  }

  /** Sets the freeze cutoff and flips status to `'frozen'`. */
  async setFreezeWindow(releaseId: string, freezeAt: Date): Promise<void> {
    await this.pool.query(
      `UPDATE releases SET freeze_at = $1, status = 'frozen', updated_at = NOW() WHERE id = $2`,
      [freezeAt, releaseId],
    )
  }

  /** True once `at` (default: now) reaches the release's `freeze_at`; `false` if no freeze window is set. */
  async isInFreezeWindow(releaseId: string, at: Date = new Date()): Promise<boolean> {
    const result = await this.pool.query<{ freeze_at: Date | null }>(
      'SELECT freeze_at FROM releases WHERE id = $1',
      [releaseId],
    )
    const freezeAt = result.rows[0]?.freeze_at
    if (!freezeAt) return false
    return at >= new Date(freezeAt)
  }

  /**
   * Fetches the release's tickets from Linear (optionally filtered by
   * label), flattens them into {@link ManifestTicket} rows, computes
   * status/priority summary counts, persists the manifest to the release
   * row, and returns it.
   */
  async buildManifest(
    releaseId: string,
    linearClient: ReleaseLinearClient,
    teamId: string,
    labelFilter?: string[],
  ): Promise<ReleaseManifest> {
    const release = await this.getRelease(releaseId)
    if (!release) throw new Error(`Release ${releaseId} not found`)

    const filterOptions =
      labelFilter?.length ? { filter: { label: { name: { in: labelFilter } } } } : {}

    const tickets = await linearClient.listTeamIssues(teamId, filterOptions)

    const manifestTickets: ManifestTicket[] = tickets.map((t) => ({
      id: t.id,
      identifier: t.identifier,
      title: t.title,
      description: t.description,
      status: t.state.name,
      priority: t.priority,
      labels: t.labels.map((l) => l.name),
      assignee: t.assignee?.name,
      url: t.url,
    }))

    const byStatus: Record<string, number> = {}
    const byPriority: Record<number, number> = {}
    for (const t of manifestTickets) {
      byStatus[t.status] = (byStatus[t.status] ?? 0) + 1
      byPriority[t.priority] = (byPriority[t.priority] ?? 0) + 1
    }

    const manifest: ReleaseManifest = {
      releaseId,
      version: release.version,
      generatedAt: new Date().toISOString(),
      linearCycleId: release.linearCycleId,
      tickets: manifestTickets,
      summary: { total: manifestTickets.length, byStatus, byPriority },
    }

    await this.pool.query(
      `UPDATE releases SET manifest = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(manifest), releaseId],
    )

    return manifest
  }

  /**
   * Pure function: renders release notes markdown from a manifest, bucketing
   * tickets into Features / Fixes / Improvements / Other by label keyword.
   * Takes no database dependency so it's trivially testable and reusable
   * for a dry-run preview before {@link saveNotes} persists the result.
   */
  generateNotes(manifest: ReleaseManifest): string {
    const { version, generatedAt, tickets, summary } = manifest

    const sections: Record<string, ManifestTicket[]> = {
      Features: [],
      Fixes: [],
      Improvements: [],
      Other: [],
    }

    for (const t of tickets) {
      const labels = t.labels.map((l) => l.toLowerCase())
      if (labels.some((l) => l === 'feat' || l === 'feature' || l.startsWith('feat'))) {
        sections.Features.push(t)
      } else if (labels.some((l) => l === 'bug' || l === 'fix' || l.startsWith('bug') || l.startsWith('fix'))) {
        sections.Fixes.push(t)
      } else if (labels.some((l) => ['improvement', 'enhancement', 'chore'].includes(l))) {
        sections.Improvements.push(t)
      } else {
        sections.Other.push(t)
      }
    }

    const lines: string[] = [
      `# Release ${version}`,
      '',
      `> Generated: ${generatedAt}`,
      `> Tickets: ${summary.total}`,
      '',
    ]

    for (const [heading, sectionTickets] of Object.entries(sections)) {
      if (sectionTickets.length === 0) continue
      lines.push(`## ${heading}`, '')
      for (const t of sectionTickets) {
        const ref = t.url ? `[${t.identifier}](${t.url})` : t.identifier
        lines.push(`- ${ref} ${t.title}`)
      }
      lines.push('')
    }

    return lines.join('\n').trimEnd() + '\n'
  }

  /** Persists release notes (typically the output of {@link generateNotes}, possibly hand-edited) to the release row. */
  async saveNotes(releaseId: string, notes: string): Promise<void> {
    await this.pool.query(
      `UPDATE releases SET notes = $1, updated_at = NOW() WHERE id = $2`,
      [notes, releaseId],
    )
  }

  /** Lists releases newest-first, optionally filtered to one status. */
  async listReleases(status?: ReleaseStatus): Promise<ReleaseRecord[]> {
    if (status !== undefined) {
      const result = await this.pool.query<DBRow>(
        'SELECT * FROM releases WHERE status = $1 ORDER BY created_at DESC',
        [status],
      )
      return result.rows.map(toRecord)
    }
    const result = await this.pool.query<DBRow>(
      'SELECT * FROM releases ORDER BY created_at DESC',
    )
    return result.rows.map(toRecord)
  }
}

export function createReleaseManager(pool: ReleasesPool): ReleaseManager {
  return new ReleaseManager(pool)
}
