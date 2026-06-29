import pg from "pg";
import { SCHEMA_SQL } from "./schema.js";

const { Pool } = pg;

export type DbClient = pg.Pool;

let pool: pg.Pool | null = null;

export function getDb(): pg.Pool {
  if (!pool) {
    const connectionString = process.env["DATABASE_URL"];
    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable is required");
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}

export async function migrate(db: pg.Pool): Promise<void> {
  await db.query(SCHEMA_SQL);
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
