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

/** Minimal pool shape `ReleaseManager` depends on, so tests can inject a fake. */
export type ReleasesPool = Pick<Pool, 'query'>

/**
 * Minimal Linear client shape `ReleaseManager` depends on for manifest
 * building, kept narrow so tests can inject a fake instead of a full SDK client.
 */
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
 * Manages Linear-planned releases: manifests, notes, and freeze windows.
 *
 * This is distinct from the older `release/` module, which ports git
 * branch/tag mechanics — `ReleaseManager` is the Linear-aware planning layer
 * on top of that. The pool and Linear client are both injected so this class
 * can be tested without a real database or network access.
 */
export class ReleaseManager {
  private readonly pool: ReleasesPool

  constructor(pool: ReleasesPool) {
    this.pool = pool
  }

  /** Plans a new release by inserting a row in `'planning'` status. */
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

  /** Fetches a release by id, or `null` if it doesn't exist. */
  async getRelease(releaseId: string): Promise<ReleaseRecord | null> {
    const result = await this.pool.query<DBRow>('SELECT * FROM releases WHERE id = $1', [
      releaseId,
    ])
    return result.rows[0] ? toRecord(result.rows[0]) : null
  }

  /**
   * Updates a release's status. When transitioning to `'released'`, this
   * also stamps `released_at = NOW()` in the same statement, so the
   * release timestamp is always set atomically with the status change
   * rather than relying on a separate call that could be skipped or race.
   */
  async updateStatus(releaseId: string, status: ReleaseStatus): Promise<void> {
    const releasedClause = status === 'released' ? ', released_at = NOW()' : ''
    await this.pool.query(
      `UPDATE releases SET status = $1, updated_at = NOW()${releasedClause} WHERE id = $2`,
      [status, releaseId],
    )
  }

  /**
   * Sets the freeze cutoff and flips the release into `'frozen'` status.
   * A freeze window is the cutoff after which no more tickets are planned
   * into the release, giving the release a stable, auditable scope going
   * into final QA and ship.
   */
  async setFreezeWindow(releaseId: string, freezeAt: Date): Promise<void> {
    await this.pool.query(
      `UPDATE releases SET freeze_at = $1, status = 'frozen', updated_at = NOW() WHERE id = $2`,
      [freezeAt, releaseId],
    )
  }

  /**
   * Returns true once `at` has reached the release's freeze cutoff
   * (`at` defaults to now). Used to gate whether new tickets may still be
   * planned into the release.
   */
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
   * Fetches the relevant Linear tickets for this release, maps them to
   * {@link ManifestTicket}s, computes `summary.byStatus`/`summary.byPriority`
   * rollups, persists the resulting manifest as JSON on the release row,
   * and returns it. This is what ties a release back to ticketed,
   * on-the-record work per the spec's provenance requirement — anyone
   * auditing a release can see exactly which tickets it covers.
   *
   * @param releaseId - Release to build the manifest for.
   * @param linearClient - Client used to fetch the team's tickets.
   * @param teamId - Linear team to pull tickets from.
   * @param labelFilter - Optional label allowlist; if omitted, all of the
   *   team's tickets are included.
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
   * Renders release notes as markdown from an already-built manifest,
   * bucketing tickets by label into Features/Fixes/Improvements/Other
   * sections and linking to the ticket URL when present.
   *
   * Deliberately a pure function (no DB access) so notes can be previewed,
   * diffed, or regenerated without touching the database — persisting the
   * result is a separate, explicit step via {@link ReleaseManager.saveNotes}.
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

  /** Persists previously generated release notes onto the release row. */
  async saveNotes(releaseId: string, notes: string): Promise<void> {
    await this.pool.query(
      `UPDATE releases SET notes = $1, updated_at = NOW() WHERE id = $2`,
      [notes, releaseId],
    )
  }

  /** Lists releases newest first, optionally filtered to a single status. */
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

/** Factory for {@link ReleaseManager}. */
export function createReleaseManager(pool: ReleasesPool): ReleaseManager {
  return new ReleaseManager(pool)
}
