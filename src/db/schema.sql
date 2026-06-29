-- harbormaster schema

CREATE TABLE IF NOT EXISTS tickets (
  id            TEXT PRIMARY KEY,
  linear_id     TEXT,
  title         TEXT NOT NULL,
  branch        TEXT,
  agent_id      TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  risk_level    TEXT NOT NULL DEFAULT 'medium',
  impact_surface JSONB NOT NULL DEFAULT '[]',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dispatch_plans (
  id         TEXT PRIMARY KEY,
  decision   TEXT NOT NULL,
  ticket_ids JSONB NOT NULL,
  reason     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gate_results (
  id          TEXT PRIMARY KEY,
  ticket_id   TEXT NOT NULL REFERENCES tickets(id),
  stage       TEXT NOT NULL,
  status      TEXT NOT NULL,
  message     TEXT,
  reviewer_id TEXT,
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         TEXT PRIMARY KEY,
  ticket_id  TEXT,
  agent_id   TEXT,
  event      TEXT NOT NULL,
  data       JSONB NOT NULL DEFAULT '{}',
  timestamp  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS releases (
  id               TEXT PRIMARY KEY,
  version          TEXT NOT NULL UNIQUE,
  branch           TEXT NOT NULL,
  linear_release_id TEXT,
  status           TEXT NOT NULL DEFAULT 'planning',
  ticket_ids       JSONB NOT NULL DEFAULT '[]',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  shipped_at       TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS hotspot_leases (
  id          TEXT PRIMARY KEY,
  path        TEXT NOT NULL,
  ticket_id   TEXT NOT NULL REFERENCES tickets(id),
  agent_id    TEXT NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_linear_id ON tickets(linear_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_ticket_id ON audit_log(ticket_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_hotspot_leases_path ON hotspot_leases(path);
CREATE INDEX IF NOT EXISTS idx_hotspot_leases_expires ON hotspot_leases(expires_at);
