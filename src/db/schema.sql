-- harbormaster initial schema

CREATE TABLE IF NOT EXISTS releases (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version     TEXT NOT NULL UNIQUE,
  branch      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'planning',  -- planning | open | frozen | shipped
  linear_id   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  shipped_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS tickets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  linear_id       TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | dispatched | in_flight | merged | failed
  release_id      UUID REFERENCES releases(id),
  assigned_agent  TEXT,
  branch_name     TEXT,
  worktree_path   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dispatch_plans (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id    UUID NOT NULL REFERENCES releases(id),
  plan_json     JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hotspot_leases (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  path        TEXT NOT NULL,
  ticket_id   UUID NOT NULL REFERENCES tickets(id),
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at TIMESTAMPTZ,
  CONSTRAINT unique_active_lease UNIQUE (path, released_at)
);

CREATE TABLE IF NOT EXISTS gate_decisions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID NOT NULL REFERENCES tickets(id),
  gate_type   TEXT NOT NULL,  -- scope | ci | qa | hitl
  status      TEXT NOT NULL,  -- pending | passed | failed | approved
  actor       TEXT,
  notes       TEXT,
  decided_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  event_type  TEXT NOT NULL,
  ticket_id   UUID REFERENCES tickets(id),
  release_id  UUID REFERENCES releases(id),
  agent_id    TEXT,
  payload     JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_ticket ON audit_log(ticket_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_release ON audit_log(release_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_release ON tickets(release_id);
CREATE INDEX IF NOT EXISTS idx_hotspot_leases_path ON hotspot_leases(path) WHERE released_at IS NULL;
