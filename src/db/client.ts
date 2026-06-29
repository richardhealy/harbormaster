import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

let _pool: Pool | undefined;

export function getPool(connectionString?: string): Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: connectionString ?? process.env['DATABASE_URL'],
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return _pool;
}

export async function query<R extends QueryResultRow = QueryResultRow>(
  sql: string,
  params?: unknown[],
  connectionString?: string,
): Promise<QueryResult<R>> {
  const pool = getPool(connectionString);
  return pool.query<R>(sql, params);
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  connectionString?: string,
): Promise<T> {
  const pool = getPool(connectionString);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = undefined;
  }
}

export function resetPool(): void {
  _pool = undefined;
}
