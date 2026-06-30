import { Pool } from 'pg'

let pool: Pool | null = null

/**
 * Returns the process-wide Postgres pool, creating it on first call.
 * The connection string is only read on creation — subsequent calls
 * (even with a different `connectionString`) return the existing pool.
 * Call {@link closePool} first if you need to reconnect with new settings.
 */
export function getPool(connectionString?: string): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: connectionString ?? process.env.DATABASE_URL ?? 'postgresql://localhost:5432/harbormaster',
    })
  }
  return pool
}

/** Ends the process-wide pool and clears it so a later {@link getPool} call creates a fresh one. */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}
