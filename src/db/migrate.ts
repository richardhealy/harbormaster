import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import type { Pool } from 'pg'

/**
 * Applies every `.sql` file in `migrationsDir` that isn't already recorded in
 * `schema_migrations`, in filename order. Each migration runs in its own
 * transaction (BEGIN/COMMIT, rollback on error) so a failure partway through
 * a file never leaves that file half-applied, and already-applied files are
 * skipped on the next run — safe to call on every process start.
 */
export async function runMigrations(pool: Pool, migrationsDir: string): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT        PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  const files = await readdir(migrationsDir)
  const sqlFiles = files.filter((f) => f.endsWith('.sql')).sort()

  for (const file of sqlFiles) {
    const version = file.replace('.sql', '')
    const { rows } = await pool.query('SELECT version FROM schema_migrations WHERE version = $1', [
      version,
    ])
    if (rows.length > 0) continue

    const sql = await readFile(join(migrationsDir, file), 'utf-8')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version])
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }
}
