import { PoolClient } from 'pg';
import { withTransaction } from './index';

const MIGRATIONS: Array<{ version: number; name: string; up: string }> = [
  {
    version: 1,
    name: 'create_schema',
    up: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id BIGSERIAL PRIMARY KEY,
        event_type TEXT NOT NULL,
        ticket_id TEXT,
        agent_id TEXT,
        branch TEXT,
        payload JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS audit_log_ticket_idx ON audit_log(ticket_id);
      CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log(created_at);

      CREATE TABLE IF NOT EXISTS hotspot_leases (
        id BIGSERIAL PRIMARY KEY,
        resource TEXT NOT NULL,
        ticket_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        released_at TIMESTAMPTZ,
        UNIQUE (resource, released_at)
      );

      CREATE TABLE IF NOT EXISTS dispatch_plan (
        id BIGSERIAL PRIMARY KEY,
        ticket_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending',
        impact_surface JSONB NOT NULL DEFAULT '[]',
        parallel_with JSONB NOT NULL DEFAULT '[]',
        sequenced_after JSONB NOT NULL DEFAULT '[]',
        merged_with JSONB NOT NULL DEFAULT '[]',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS releases (
        id BIGSERIAL PRIMARY KEY,
        version TEXT NOT NULL UNIQUE,
        branch TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'planning',
        linear_release_id TEXT,
        manifest JSONB NOT NULL DEFAULT '{}',
        notes TEXT,
        freeze_start TIMESTAMPTZ,
        freeze_end TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `,
  },
];

export async function runMigrations(): Promise<void> {
  await withTransaction(async (client: PoolClient) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const { rows } = await client.query<{ version: number }>(
      'SELECT version FROM schema_migrations ORDER BY version'
    );
    const applied = new Set(rows.map((r) => r.version));

    for (const migration of MIGRATIONS) {
      if (!applied.has(migration.version)) {
        await client.query(migration.up);
        await client.query(
          'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
          [migration.version, migration.name]
        );
        console.log(`Applied migration ${migration.version}: ${migration.name}`);
      }
    }
  });
}
