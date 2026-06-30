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
 * Linear-planned releases: manifests, notes, and freeze windows (spec
 * section "Release planning"). Distinct from `src/release/`, which ports
 * the `release.sh` git lifecycle (branches, tags, hotfixes) — this module
 * is the Linear-facing planning layer on top of it.
 */
export class ReleaseManager {
  private readonly pool: ReleasesPool

  constructor(pool: ReleasesPool) {
    this.pool = pool
  }

  /** Inserts a new release row in `'planning'` status. */
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

  async getRelease(releaseId: string): Promise<ReleaseRecord | null> {
    const result = await this.pool.query<DBRow>('SELECT * FROM releases WHERE id = $1', [
      releaseId,
    ])
    return result.rows[0] ? toRecord(result.rows[0]) : null
  }

  /** Updates a release's status. Setting `'released'` also stamps `released_at`. */
  async updateStatus(releaseId: string, status: ReleaseStatus): Promise<void> {
    const releasedClause = status === 'released' ? ', released_at = NOW()' : ''
    await this.pool.query(
      `UPDATE releases SET status = $1, updated_at = NOW()${releasedClause} WHERE id = $2`,
      [status, releaseId],
    )
  }

  /** Sets the release's freeze cutoff and moves its status to `'frozen'`. */
  async setFreezeWindow(releaseId: string, freezeAt: Date): Promise<void> {
    await this.pool.query(
      `UPDATE releases SET freeze_at = $1, status = 'frozen', updated_at = NOW() WHERE id = $2`,
      [freezeAt, releaseId],
    )
  }

  /** Returns whether `at` (default: now) falls on or after the release's freeze cutoff. `false` if no freeze window is set. */
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
   * Pulls the team's current Linear tickets (optionally narrowed by `labelFilter`),
   * projects them into {@link ManifestTicket}s, computes status/priority breakdowns,
   * and persists the resulting manifest onto the release row before returning it.
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
   * Renders a manifest into markdown release notes, bucketing tickets into
   * Features / Fixes / Improvements / Other by label (matched against
   * `feat*`/`bug*`/`fix*`/improvement-style labels, falling through to
   * Other). Pure — does not touch the database.
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

  /** Persists previously generated (or hand-edited) notes onto the release row. */
  async saveNotes(releaseId: string, notes: string): Promise<void> {
    await this.pool.query(
      `UPDATE releases SET notes = $1, updated_at = NOW() WHERE id = $2`,
      [notes, releaseId],
    )
  }

  /** Lists releases newest-first, optionally filtered to a single status. */
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

/** Factory mirroring the other modules' `create*` convention. */
export function createReleaseManager(pool: ReleasesPool): ReleaseManager {
  return new ReleaseManager(pool)
}
