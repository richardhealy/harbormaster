import type {
  ReleasesPool,
  Release,
  ReleaseStatus,
  CreateReleaseOptions,
  UpdateReleaseOptions,
  ReleaseManifest,
  FreezeWindowResult,
  LinearIssueFilter,
} from './types'
import type { LinearClient } from '../integrations/linear/index'
import type { LinearTicket } from '../integrations/linear/types'
import { ManifestBuilder } from './manifest'
import { ReleaseNotesGenerator } from './notes'
import { ReleasePlanner } from './planner'
import { FreezeWindowManager } from './freeze'

export type {
  ReleasesPool,
  Release,
  ReleaseStatus,
  CreateReleaseOptions,
  UpdateReleaseOptions,
  ReleaseManifest,
  FreezeWindowResult,
}
export type { ReleasePlan, ReleaseManifestEntry, ReleaseNotesOptions } from './types'
export { ManifestBuilder } from './manifest'
export { ReleaseNotesGenerator } from './notes'
export { ReleasePlanner } from './planner'
export { FreezeWindowManager } from './freeze'

function rowToRelease(row: Record<string, unknown>): Release {
  return {
    id: row['id'] as string,
    version: row['version'] as string,
    branch: row['branch'] as string,
    status: row['status'] as ReleaseStatus,
    linearCycleId: (row['linear_cycle_id'] as string | null) ?? undefined,
    manifest: (row['manifest'] as ReleaseManifest | null) ?? undefined,
    notes: (row['notes'] as string | null) ?? undefined,
    freezeAt: row['freeze_at'] ? new Date(row['freeze_at'] as string) : undefined,
    releasedAt: row['released_at'] ? new Date(row['released_at'] as string) : undefined,
    createdAt: new Date(row['created_at'] as string),
    updatedAt: new Date(row['updated_at'] as string),
  }
}

export class ReleaseManager {
  private readonly manifestBuilder: ManifestBuilder
  private readonly notesGenerator: ReleaseNotesGenerator
  private readonly freezeManager: FreezeWindowManager
  private readonly planner?: ReleasePlanner

  constructor(
    private readonly pool: ReleasesPool,
    linear?: LinearClient,
  ) {
    this.manifestBuilder = new ManifestBuilder()
    this.notesGenerator = new ReleaseNotesGenerator()
    this.freezeManager = new FreezeWindowManager()
    if (linear) this.planner = new ReleasePlanner(linear)
  }

  async createRelease(options: CreateReleaseOptions): Promise<Release> {
    const { version, branch, linearCycleId, freezeAt } = options
    const result = await this.pool.query(
      `INSERT INTO releases (version, branch, linear_cycle_id, freeze_at)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [version, branch, linearCycleId ?? null, freezeAt ?? null],
    )
    return rowToRelease(result.rows[0])
  }

  async getRelease(releaseId: string): Promise<Release | null> {
    const result = await this.pool.query('SELECT * FROM releases WHERE id = $1', [releaseId])
    return result.rows[0] ? rowToRelease(result.rows[0]) : null
  }

  async getByVersion(version: string): Promise<Release | null> {
    const result = await this.pool.query('SELECT * FROM releases WHERE version = $1', [version])
    return result.rows[0] ? rowToRelease(result.rows[0]) : null
  }

  async listReleases(status?: ReleaseStatus): Promise<Release[]> {
    const result = status
      ? await this.pool.query(
          'SELECT * FROM releases WHERE status = $1 ORDER BY created_at DESC',
          [status],
        )
      : await this.pool.query('SELECT * FROM releases ORDER BY created_at DESC')
    return result.rows.map(rowToRelease)
  }

  async updateRelease(releaseId: string, options: UpdateReleaseOptions): Promise<Release> {
    const sets: string[] = []
    const values: unknown[] = []
    let i = 1

    if (options.status !== undefined) {
      sets.push(`status = $${i++}`)
      values.push(options.status)
    }
    if (options.manifest !== undefined) {
      sets.push(`manifest = $${i++}`)
      values.push(JSON.stringify(options.manifest))
    }
    if (options.notes !== undefined) {
      sets.push(`notes = $${i++}`)
      values.push(options.notes)
    }
    if (options.freezeAt !== undefined) {
      sets.push(`freeze_at = $${i++}`)
      values.push(options.freezeAt)
    }
    if (options.releasedAt !== undefined) {
      sets.push(`released_at = $${i++}`)
      values.push(options.releasedAt)
    }
    sets.push('updated_at = NOW()')
    values.push(releaseId)

    const result = await this.pool.query(
      `UPDATE releases SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      values,
    )
    return rowToRelease(result.rows[0])
  }

  buildManifest(
    version: string,
    tickets: LinearTicket[],
    dispatchMap?: Map<string, { dispatchId?: string; mergedAt?: string }>,
  ): ReleaseManifest {
    return this.manifestBuilder.build(version, tickets, dispatchMap)
  }

  generateNotes(manifest: ReleaseManifest): string {
    return this.notesGenerator.generate(manifest)
  }

  async attachManifest(
    releaseId: string,
    tickets: LinearTicket[],
    dispatchMap?: Map<string, { dispatchId?: string; mergedAt?: string }>,
  ): Promise<Release> {
    const release = await this.getRelease(releaseId)
    if (!release) throw new Error(`Release ${releaseId} not found`)
    const manifest = this.buildManifest(release.version, tickets, dispatchMap)
    const notes = this.generateNotes(manifest)
    return this.updateRelease(releaseId, { manifest, notes })
  }

  async setFreezeWindow(releaseId: string, freezeAt: Date): Promise<Release> {
    return this.updateRelease(releaseId, { freezeAt })
  }

  async checkFreeze(): Promise<FreezeWindowResult> {
    const releases = await this.listReleases()
    return this.freezeManager.isFrozen(releases)
  }

  async freeze(releaseId: string): Promise<Release> {
    return this.updateRelease(releaseId, { status: 'frozen' })
  }

  async markReleased(releaseId: string): Promise<Release> {
    return this.updateRelease(releaseId, { status: 'released', releasedAt: new Date() })
  }

  async planFromLinear(
    teamId: string,
    version: string,
    branch: string,
    options: { filter?: LinearIssueFilter; limit?: number; linearCycleId?: string } = {},
  ) {
    if (!this.planner) throw new Error('LinearClient required for planFromLinear')
    return this.planner.planFromTeamIssues(teamId, version, branch, options)
  }
}

export function createReleaseManager(pool: ReleasesPool, linear?: LinearClient): ReleaseManager {
  return new ReleaseManager(pool, linear)
}
