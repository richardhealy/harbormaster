/**
 * Minimal, dependency-free SQL migration runner.
 *
 * Applied migrations are tracked in a `schema_migrations` table keyed by
 * file name (without extension), so re-running this function is idempotent
 * and only executes migrations that haven't been applied yet.
 */
import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import type { Pool } from 'pg'

/**
 * Applies all pending `.sql` migrations from `migrationsDir`, in ascending
 * filename order (e.g. `001_initial.sql` before `002_...sql`), skipping any
 * whose version is already recorded in `schema_migrations`.
 *
 * Each migration runs in its own transaction together with the bookkeeping
 * insert, so a failing migration is rolled back in full and does not get
 * marked as applied — the next run will retry it. Migrations already
 * committed in prior runs are left untouched.
 *
 * @param pool - Connection pool used both to read migration state and to run each migration.
 * @param migrationsDir - Directory containing `.sql` migration files.
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
