-- Initial harbormaster schema

-- Audit / provenance log: every significant event is immutable here
CREATE TABLE IF NOT EXISTS audit_log (
  id            BIGSERIAL PRIMARY KEY,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_type    VARCHAR(64)  NOT NULL,
  ticket_id     VARCHAR(128),
  agent_id      VARCHAR(128),
  branch        VARCHAR(255),
  sha           VARCHAR(64),
  release_tag   VARCHAR(64),
  payload       JSONB        NOT NULL DEFAULT '{}'
);

CREATE INDEX audit_log_ticket_id_idx  ON audit_log (ticket_id)  WHERE ticket_id IS NOT NULL;
CREATE INDEX audit_log_event_type_idx ON audit_log (event_type);
CREATE INDEX audit_log_created_at_idx ON audit_log (created_at DESC);

-- Release records
CREATE TABLE IF NOT EXISTS releases (
  id           BIGSERIAL PRIMARY KEY,
  version      VARCHAR(64)  NOT NULL UNIQUE,
  branch       VARCHAR(255) NOT NULL,
  state        VARCHAR(32)  NOT NULL DEFAULT 'open',   -- open | frozen | shipped | yanked
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  shipped_at   TIMESTAMPTZ,
  manifest     JSONB        NOT NULL DEFAULT '[]',
  notes        TEXT
);

-- Hotspot advisory leases
CREATE TABLE IF NOT EXISTS hotspot_leases (
  id           BIGSERIAL PRIMARY KEY,
  path         VARCHAR(512) NOT NULL,
  agent_id     VARCHAR(128) NOT NULL,
  ticket_id    VARCHAR(128),
  acquired_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL,
  released_at  TIMESTAMPTZ,
  UNIQUE (path, released_at)  -- only one active lease per path
);

CREATE INDEX hotspot_leases_path_idx ON hotspot_leases (path) WHERE released_at IS NULL;

-- Dispatch records: each scheduled unit of agent work
CREATE TABLE IF NOT EXISTS dispatches (
  id           BIGSERIAL PRIMARY KEY,
  ticket_id    VARCHAR(128) NOT NULL,
  agent_id     VARCHAR(128),
  branch       VARCHAR(255),
  worktree_path VARCHAR(512),
  state        VARCHAR(32)  NOT NULL DEFAULT 'pending', -- pending | running | integrating | done | failed | requeued
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  attempt      INT          NOT NULL DEFAULT 1,
  impact_surface JSONB      NOT NULL DEFAULT '[]',
  metadata     JSONB        NOT NULL DEFAULT '{}'
);

CREATE INDEX dispatches_ticket_id_idx ON dispatches (ticket_id);
CREATE INDEX dispatches_state_idx     ON dispatches (state);

-- Gate decisions for each dispatch
CREATE TABLE IF NOT EXISTS gate_decisions (
  id           BIGSERIAL PRIMARY KEY,
  dispatch_id  BIGINT       NOT NULL REFERENCES dispatches (id),
  gate_type    VARCHAR(32)  NOT NULL,  -- scope | ci | qa | hitl
  verdict      VARCHAR(16)  NOT NULL,  -- pass | fail | pending | skip
  decided_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_by   VARCHAR(128),
  notes        TEXT
);

CREATE INDEX gate_decisions_dispatch_id_idx ON gate_decisions (dispatch_id);
