import * as fs from 'fs';
import * as path from 'path';
import { getPool, closePool } from './client';

const MIGRATIONS_DIR = path.join(__dirname, '../../migrations');

async function ensureMigrationsTable(pool: ReturnType<typeof getPool>): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getApplied(pool: ReturnType<typeof getPool>): Promise<Set<string>> {
  const result = await pool.query<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version');
  return new Set(result.rows.map(r => r.version));
}

async function runMigration(pool: ReturnType<typeof getPool>, file: string, sql: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
    await client.query('COMMIT');
    console.log(`Applied migration: ${file}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
  } finally {
    client.release();
  }
}

export async function migrate(connectionString?: string): Promise<void> {
  const pool = getPool(connectionString);
  await ensureMigrationsTable(pool);
  const applied = await getApplied(pool);

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    await runMigration(pool, file, sql);
  }
}

// Run as CLI
if (require.main === module) {
  migrate()
    .then(() => {
      console.log('Migrations complete');
      return closePool();
    })
    .catch(err => {
      console.error('Migration error:', err);
      process.exit(1);
    });
}
