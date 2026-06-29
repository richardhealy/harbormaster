-- Tracks applied schema migrations
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Immutable audit log: every dispatch, gate decision, and merge
CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  TEXT NOT NULL,
  ticket_id   TEXT,
  agent_id    TEXT,
  branch      TEXT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_log_ticket_id_idx ON audit_log (ticket_id);
CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log (created_at);

-- Advisory leases for hotspots (migrations, shared contracts)
CREATE TABLE IF NOT EXISTS hotspot_leases (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  path        TEXT NOT NULL UNIQUE,
  holder_id   TEXT NOT NULL,
  ticket_id   TEXT NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS hotspot_leases_path_idx ON hotspot_leases (path);

-- Scheduler dispatch plans
CREATE TABLE IF NOT EXISTS dispatch_plans (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tickets     JSONB NOT NULL,
  plan        JSONB NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'done', 'failed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
