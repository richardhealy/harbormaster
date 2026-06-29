import { Pool, PoolConfig, QueryResult, QueryResultRow } from 'pg';

let _pool: Pool | null = null;

export function createPool(config?: PoolConfig): Pool {
  return new Pool(config ?? { connectionString: process.env.DATABASE_URL });
}

export function getPool(): Pool {
  if (!_pool) {
    _pool = createPool();
  }
  return _pool;
}

export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  values?: unknown[],
): Promise<QueryResult<T>> {
  return getPool().query<T>(sql, values);
}

export { Pool };
