import type { LinearTicket } from '../integrations/linear'
import type {
  CreateReleaseOptions,
  ManifestEntry,
  ReleaseManifest,
  ReleasePool,
  ReleaseRecord,
  ReleaseStatus,
} from './types'
import { generateNotes } from './notes'

interface RawReleaseRow {
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

const SELECT_COLS = `id, version, branch, status, linear_cycle_id, manifest, notes,
                     freeze_at, released_at, created_at, updated_at`

function rowToRecord(row: RawReleaseRow): ReleaseRecord {
  return {
    id: row.id,
    version: row.version,
    branch: row.branch,
    status: row.status as ReleaseStatus,
    linearCycleId: row.linear_cycle_id ?? undefined,
    manifest: row.manifest ?? undefined,
    notes: row.notes ?? undefined,
    freezeAt: row.freeze_at ?? undefined,
    releasedAt: row.released_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class ReleaseManager {
  constructor(private readonly pool: ReleasePool) {}

  async create(options: CreateReleaseOptions): Promise<ReleaseRecord> {
    const result = await this.pool.query(
      `INSERT INTO releases (version, branch, linear_cycle_id, freeze_at, status)
       VALUES ($1, $2, $3, $4, 'planning')
       RETURNING ${SELECT_COLS}`,
      [
        options.version,
        options.branch,
        options.linearCycleId ?? null,
        options.freezeAt ?? null,
      ],
    )
    return rowToRecord((result.rows as RawReleaseRow[])[0])
  }

  async getRelease(idOrVersion: string): Promise<ReleaseRecord | null> {
    const result = await this.pool.query(
      `SELECT ${SELECT_COLS} FROM releases WHERE id = $1 OR version = $1 LIMIT 1`,
      [idOrVersion],
    )
    const rows = result.rows as RawReleaseRow[]
    return rows.length ? rowToRecord(rows[0]) : null
  }

  /** Build a manifest from a list of Linear tickets without persisting it. */
  buildManifest(version: string, tickets: LinearTicket[]): ReleaseManifest {
    const entries: ManifestEntry[] = tickets.map((t) => ({
      ticketId: t.id,
      identifier: t.identifier,
      title: t.title,
      labels: t.labels.map((l) => l.name),
      priority: t.priority,
      url: t.url,
    }))
    return {
      version,
      generatedAt: new Date().toISOString(),
      totalTickets: entries.length,
      entries,
    }
  }

  /** Build a manifest from tickets, generate notes, and persist both to the release row. */
  async saveManifest(releaseId: string, tickets: LinearTicket[]): Promise<ReleaseManifest> {
    const release = await this.getRelease(releaseId)
    if (!release) throw new Error(`Release not found: ${releaseId}`)

    const manifest = this.buildManifest(release.version, tickets)
    const notes = generateNotes(manifest)

    await this.pool.query(
      `UPDATE releases SET manifest = $1, notes = $2, updated_at = NOW() WHERE id = $3`,
      [manifest, notes, releaseId],
    )
    return manifest
  }

  /**
   * Freeze a release so no new merges are accepted.
   * Defaults to immediately if `at` is omitted.
   */
  async freeze(releaseId: string, at?: Date): Promise<void> {
    const freezeAt = at ?? new Date()
    await this.pool.query(
      `UPDATE releases SET status = 'frozen', freeze_at = $1, updated_at = NOW() WHERE id = $2`,
      [freezeAt, releaseId],
    )
  }

  /**
   * Returns true when the release is either explicitly frozen or its scheduled
   * freeze window has started.
   */
  async isFrozen(idOrVersion: string): Promise<boolean> {
    const release = await this.getRelease(idOrVersion)
    if (!release) return false
    if (release.status === 'frozen') return true
    if (release.freezeAt && release.freezeAt <= new Date()) return true
    return false
  }

  async markReleased(releaseId: string): Promise<void> {
    await this.pool.query(
      `UPDATE releases
       SET status = 'released', released_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [releaseId],
    )
  }
}

export function createReleaseManager(pool: ReleasePool): ReleaseManager {
  return new ReleaseManager(pool)
}
