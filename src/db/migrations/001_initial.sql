-- Immutable record of every dispatch, gate decision, and merge event
CREATE TABLE audit_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type  TEXT        NOT NULL,
  payload     JSONB       NOT NULL,
  ticket_id   TEXT,
  agent_id    TEXT,
  actor       TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX audit_log_ticket_id  ON audit_log (ticket_id);
CREATE INDEX audit_log_event_type ON audit_log (event_type);
CREATE INDEX audit_log_created_at ON audit_log (created_at DESC);

-- Tickets synced from Linear
CREATE TABLE tickets (
  id           TEXT        PRIMARY KEY,
  title        TEXT        NOT NULL,
  status       TEXT        NOT NULL,
  priority     INTEGER,
  labels       TEXT[],
  assignee_id  TEXT,
  linear_data  JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Agent work assignments produced by the scheduler
CREATE TABLE dispatches (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       TEXT        NOT NULL REFERENCES tickets(id),
  agent_id        TEXT        NOT NULL,
  branch          TEXT        NOT NULL,
  worktree_path   TEXT,
  status          TEXT        NOT NULL DEFAULT 'pending',
  impact_surface  JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX dispatches_ticket_id ON dispatches (ticket_id);
CREATE INDEX dispatches_status    ON dispatches (status);

-- Per-dispatch gate pass/fail records (scope, CI, QA, HITL)
CREATE TABLE gate_decisions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_id  UUID        NOT NULL REFERENCES dispatches(id),
  gate_type    TEXT        NOT NULL,
  status       TEXT        NOT NULL,
  actor        TEXT,
  notes        TEXT,
  decided_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX gate_decisions_dispatch_id ON gate_decisions (dispatch_id);

-- Releases assembled from merged, ticketed work
CREATE TABLE releases (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  version          TEXT        NOT NULL UNIQUE,
  branch           TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'planning',
  linear_cycle_id  TEXT,
  manifest         JSONB,
  notes            TEXT,
  freeze_at        TIMESTAMPTZ,
  released_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX releases_version ON releases (version);
CREATE INDEX releases_status  ON releases (status);
