import { Pool } from 'pg'

let pool: Pool | null = null

/**
 * Returns the process-wide Postgres pool, creating it on first call.
 * Subsequent calls ignore `connectionString` and return the existing pool —
 * this is a singleton by design so every module shares one connection pool
 * instead of each opening its own.
 */
export function getPool(connectionString?: string): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: connectionString ?? process.env.DATABASE_URL ?? 'postgresql://localhost:5432/harbormaster',
    })
  }
  return pool
}

/** Closes the shared pool and clears the singleton, so a later `getPool()` call opens a fresh one. Intended for test teardown and graceful shutdown. */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}
