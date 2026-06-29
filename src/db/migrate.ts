import * as fs from 'fs';
import * as path from 'path';
import { getPool, closePool } from './index';

export async function migrate(schemaPath?: string): Promise<void> {
  const pool = getPool();
  const sql = fs.readFileSync(schemaPath ?? path.join(__dirname, 'schema.sql'), 'utf8');

  await pool.query(sql);
}

if (require.main === module) {
  migrate()
    .then(() => {
      console.log('Migrations applied successfully');
      return closePool();
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
