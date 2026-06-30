import { Pool } from 'pg'

let pool: Pool | null = null

/**
 * Returns the process-wide Postgres connection pool, creating it on first
 * call. Subsequent calls ignore `connectionString` and return the existing
 * pool — this is a singleton by design so every module shares one set of
 * connections instead of exhausting Postgres's connection limit.
 */
export function getPool(connectionString?: string): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: connectionString ?? process.env.DATABASE_URL ?? 'postgresql://localhost:5432/harbormaster',
    })
  }
  return pool
}

/**
 * Ends the singleton pool and clears it so a subsequent {@link getPool} call
 * creates a fresh one. Used by tests and graceful shutdown; safe to call
 * when no pool has been created yet.
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}
