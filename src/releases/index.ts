import type { LinearTicket } from '../integrations/linear'
import type { ProvenanceRecorder } from '../provenance'
import type {
  CreateReleaseOptions,
  ManifestBuildOptions,
  ReleaseManifest,
  ReleaseManifestEntry,
  ReleaseRecord,
  ReleaseStatus,
} from './types'
import { PRIORITY_LABELS } from './types'

export type {
  CreateReleaseOptions,
  ManifestBuildOptions,
  ReleaseManifest,
  ReleaseManifestEntry,
  ReleaseRecord,
  ReleaseStatus,
}
export { PRIORITY_LABELS } from './types'

export interface ReleasePlannerPool {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>
}

export interface LinearSource {
  listTeamIssues(teamId: string, options?: { limit?: number; filter?: Record<string, unknown> }): Promise<LinearTicket[]>
}

interface RawReleaseRow {
  id: string
  version: string
  branch: string
  status: string
  linear_cycle_id: string | null
  manifest: Record<string, unknown> | null
  notes: string | null
  freeze_at: Date | null
  released_at: Date | null
  created_at: Date
  updated_at: Date
}

function rowToRecord(row: RawReleaseRow): ReleaseRecord {
  return {
    id: row.id,
    version: row.version,
    branch: row.branch,
    status: row.status as ReleaseStatus,
    linearCycleId: row.linear_cycle_id,
    manifest: row.manifest as ReleaseManifest | null,
    notes: row.notes,
    freezeAt: row.freeze_at,
    releasedAt: row.released_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function ticketToEntry(ticket: LinearTicket): ReleaseManifestEntry {
  const priority = ticket.priority ?? 0
  return {
    ticketId: ticket.id,
    identifier: ticket.identifier,
    title: ticket.title,
    state: ticket.state.name,
    priority,
    priorityLabel: PRIORITY_LABELS[priority] ?? 'none',
    labels: ticket.labels.map((l) => l.name),
    assignee: ticket.assignee?.name,
    url: ticket.url,
  }
}

function buildByPriority(tickets: ReleaseManifestEntry[]): Record<string, ReleaseManifestEntry[]> {
  const out: Record<string, ReleaseManifestEntry[]> = {}
  for (const t of tickets) {
    const key = t.priorityLabel
    if (!out[key]) out[key] = []
    out[key].push(t)
  }
  return out
}

function buildByLabel(tickets: ReleaseManifestEntry[]): Record<string, ReleaseManifestEntry[]> {
  const out: Record<string, ReleaseManifestEntry[]> = {}
  for (const t of tickets) {
    if (t.labels.length === 0) {
      if (!out['unlabelled']) out['unlabelled'] = []
      out['unlabelled'].push(t)
    }
    for (const label of t.labels) {
      if (!out[label]) out[label] = []
      out[label].push(t)
    }
  }
  return out
}

export class ReleasePlanner {
  constructor(
    private readonly pool: ReleasePlannerPool,
    private readonly linear: LinearSource,
    private readonly provenance: ProvenanceRecorder,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {}

  async createRelease(
    version: string,
    branch: string,
    options: CreateReleaseOptions = {},
  ): Promise<ReleaseRecord> {
    const { linearCycleId = null, freezeAt = null } = options

    const result = await this.pool.query(
      `INSERT INTO releases (version, branch, status, linear_cycle_id, freeze_at)
       VALUES ($1, $2, 'planning', $3, $4)
       RETURNING id, version, branch, status, linear_cycle_id, manifest, notes,
                 freeze_at, released_at, created_at, updated_at`,
      [version, branch, linearCycleId, freezeAt],
    )

    const record = rowToRecord(result.rows[0] as RawReleaseRow)

    await this.provenance.record({
      eventType: 'release.created',
      payload: { version, branch, linearCycleId, freezeAt: freezeAt?.toISOString() ?? null },
      actor: 'harbormaster',
    })

    return record
  }

  async buildManifest(
    releaseId: string,
    teamId: string,
    options: ManifestBuildOptions = {},
  ): Promise<ReleaseManifest> {
    const { labelFilter, stateTypeFilter } = options

    const filter: Record<string, unknown> = {}
    if (stateTypeFilter) filter['state'] = { type: { eq: stateTypeFilter } }
    if (labelFilter) filter['label'] = { name: { in: [labelFilter] } }

    const tickets = await this.linear.listTeamIssues(teamId, {
      limit: 250,
      filter: Object.keys(filter).length > 0 ? filter : undefined,
    })

    const entries = tickets.map(ticketToEntry)

    const manifest: ReleaseManifest = {
      version: '',
      generatedAt: this.clock(),
      totalTickets: entries.length,
      tickets: entries,
      byPriority: buildByPriority(entries),
      byLabel: buildByLabel(entries),
    }

    const releaseRow = await this.pool.query(
      `SELECT version FROM releases WHERE id = $1`,
      [releaseId],
    )
    if (releaseRow.rows.length > 0) {
      manifest.version = (releaseRow.rows[0] as { version: string }).version
    }

    await this.pool.query(
      `UPDATE releases SET manifest = $1, updated_at = NOW() WHERE id = $2`,
      [manifest, releaseId],
    )

    return manifest
  }

  generateNotes(manifest: ReleaseManifest): string {
    const lines: string[] = []
    lines.push(`# Release ${manifest.version}`)
    lines.push('')
    lines.push(`*Generated: ${manifest.generatedAt}*`)
    lines.push(`*Total tickets: ${manifest.totalTickets}*`)
    lines.push('')

    const priorityOrder = ['urgent', 'high', 'medium', 'low', 'none']
    for (const priority of priorityOrder) {
      const group = manifest.byPriority[priority]
      if (!group || group.length === 0) continue
      lines.push(`## ${priority.charAt(0).toUpperCase() + priority.slice(1)} priority`)
      lines.push('')
      for (const t of group) {
        const ref = t.url ? `[${t.identifier}](${t.url})` : t.identifier
        const assignee = t.assignee ? ` — ${t.assignee}` : ''
        lines.push(`- ${ref} ${t.title}${assignee}`)
      }
      lines.push('')
    }

    return lines.join('\n').trimEnd()
  }

  async setFreezeWindow(releaseId: string, freezeAt: Date): Promise<void> {
    await this.pool.query(
      `UPDATE releases SET freeze_at = $1, updated_at = NOW() WHERE id = $2`,
      [freezeAt, releaseId],
    )
  }

  async activateRelease(releaseId: string): Promise<void> {
    await this.pool.query(
      `UPDATE releases SET status = 'active', updated_at = NOW() WHERE id = $1`,
      [releaseId],
    )
  }

  async publishRelease(releaseId: string): Promise<void> {
    const result = await this.pool.query(
      `UPDATE releases
       SET status = 'released', released_at = NOW(), updated_at = NOW()
       WHERE id = $1
       RETURNING version, branch`,
      [releaseId],
    )

    if (result.rows.length === 0) return

    const { version, branch } = result.rows[0] as { version: string; branch: string }

    await this.provenance.record({
      eventType: 'release.tagged',
      payload: { releaseId, version, branch },
      actor: 'harbormaster',
    })
  }

  async isFrozen(releaseId: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT status, freeze_at FROM releases WHERE id = $1`,
      [releaseId],
    )
    if (result.rows.length === 0) return false

    const row = result.rows[0] as { status: string; freeze_at: Date | null }
    if (row.status === 'frozen') return true
    if (row.freeze_at && new Date(row.freeze_at) <= new Date()) return true
    return false
  }

  async getRelease(releaseId: string): Promise<ReleaseRecord | null> {
    const result = await this.pool.query(
      `SELECT id, version, branch, status, linear_cycle_id, manifest, notes,
              freeze_at, released_at, created_at, updated_at
       FROM releases WHERE id = $1`,
      [releaseId],
    )
    if (result.rows.length === 0) return null
    return rowToRecord(result.rows[0] as RawReleaseRow)
  }

  async listReleases(status?: ReleaseStatus): Promise<ReleaseRecord[]> {
    const text = status
      ? `SELECT id, version, branch, status, linear_cycle_id, manifest, notes,
                freeze_at, released_at, created_at, updated_at
         FROM releases WHERE status = $1 ORDER BY created_at DESC`
      : `SELECT id, version, branch, status, linear_cycle_id, manifest, notes,
                freeze_at, released_at, created_at, updated_at
         FROM releases ORDER BY created_at DESC`
    const values = status ? [status] : []
    const result = await this.pool.query(text, values)
    return (result.rows as RawReleaseRow[]).map(rowToRecord)
  }

  async updateNotes(releaseId: string, notes: string): Promise<void> {
    await this.pool.query(
      `UPDATE releases SET notes = $1, updated_at = NOW() WHERE id = $2`,
      [notes, releaseId],
    )
  }
}

export function createReleasePlanner(
  pool: ReleasePlannerPool,
  linear: LinearSource,
  provenance: ProvenanceRecorder,
): ReleasePlanner {
  return new ReleasePlanner(pool, linear, provenance)
}
