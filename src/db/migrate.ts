import fs from 'fs';
import path from 'path';
import { getPool, closePool } from './client';

async function migrate(): Promise<void> {
  const pool = getPool();
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf-8');

  console.log('Running migrations...');
  await pool.query(sql);
  console.log('Migrations complete.');

  await closePool();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
