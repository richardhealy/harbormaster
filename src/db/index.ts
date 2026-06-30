/**
 * Process-wide Postgres connection pool.
 *
 * A single `Pool` is shared across the whole process rather than created
 * per-call, since each `Pool` manages its own set of pooled connections —
 * creating multiple would exhaust Postgres connection limits under load.
 */
import { Pool } from 'pg'

let pool: Pool | null = null

/**
 * Returns the shared connection pool, creating it on first call.
 *
 * The `connectionString` argument only takes effect the first time this is
 * called (e.g. during startup wiring); once the pool exists it is reused
 * as-is for the lifetime of the process, even if a different connection
 * string is passed on a later call. Falls back to `DATABASE_URL` and then
 * to a local default so the module is usable without explicit config.
 *
 * @param connectionString - Postgres connection string to use when initializing the pool.
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
 * Closes the shared pool and clears it so a subsequent `getPool` call
 * creates a fresh one. Intended for graceful shutdown and test teardown.
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}
