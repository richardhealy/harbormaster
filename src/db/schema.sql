-- harbormaster Postgres schema

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Tickets ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tickets (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  linear_id     TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | dispatched | in_progress | merged | cancelled
  branch_name   TEXT,
  worktree_path TEXT,
  agent_id      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Dispatch plans ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dispatch_plans (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_ids  TEXT[] NOT NULL,  -- ordered list of ticket UUIDs in this plan
  strategy    TEXT NOT NULL,    -- parallel | sequence | merged
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Audit log (immutable provenance) ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id   UUID REFERENCES tickets(id),
  event_type  TEXT NOT NULL,   -- dispatched | branch_created | gate_passed | gate_failed | merged | re_run | released
  actor       TEXT NOT NULL,   -- agent_id or "system" or "human:<github_login>"
  payload     JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Hotspot leases ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hotspot_leases (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotspot_key TEXT NOT NULL,   -- identifier for the hotspot (e.g. "migrations", "shared-contract:api-types")
  ticket_id   UUID NOT NULL REFERENCES tickets(id),
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at TIMESTAMPTZ
);

-- ─── Releases ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS releases (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  version      TEXT NOT NULL UNIQUE,    -- semver, e.g. "1.3.0"
  branch_name  TEXT NOT NULL,           -- e.g. "release/1.3.0"
  status       TEXT NOT NULL DEFAULT 'open',  -- open | frozen | tagged | shipped
  linear_cycle TEXT,                    -- Linear cycle/sprint id
  manifest     JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tagged_at    TIMESTAMPTZ
);

-- ─── Release tickets (join) ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS release_tickets (
  release_id  UUID NOT NULL REFERENCES releases(id),
  ticket_id   UUID NOT NULL REFERENCES tickets(id),
  PRIMARY KEY (release_id, ticket_id)
);

-- ─── Gate decisions ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS gate_decisions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id   UUID NOT NULL REFERENCES tickets(id),
  gate        TEXT NOT NULL,    -- scope | ci | qa | hitl
  outcome     TEXT NOT NULL,    -- passed | failed | pending
  actor       TEXT,
  notes       TEXT,
  decided_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_tickets_linear_id    ON tickets(linear_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status       ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_audit_events_ticket  ON audit_events(ticket_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_type    ON audit_events(event_type);
CREATE INDEX IF NOT EXISTS idx_hotspot_leases_key   ON hotspot_leases(hotspot_key) WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_gate_decisions_ticket ON gate_decisions(ticket_id);
