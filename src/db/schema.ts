/**
 * Core database schema for harbormaster.
 *
 * Tables:
 *   tickets        — Linear-sourced work items tracked through the system
 *   dispatch_plans — scheduler output: what runs now, what waits, what merges
 *   worktrees      — per-task git worktrees used for agent isolation
 *   gate_events    — immutable audit log entries for gate decisions and merges
 *   hotspot_leases — advisory locks for un-mergeable hotspots (migrations, etc.)
 *   releases       — release records assembled from ticketed work
 */

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tickets (
  id            TEXT PRIMARY KEY,
  linear_id     TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  description   TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  priority      INTEGER NOT NULL DEFAULT 0,
  labels        TEXT[] NOT NULL DEFAULT '{}',
  assignee_id   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dispatch_plans (
  id            TEXT PRIMARY KEY,
  ticket_ids    TEXT[] NOT NULL,
  action        TEXT NOT NULL CHECK (action IN ('parallel', 'sequence', 'merge')),
  reason        TEXT,
  impact_score  REAL NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'completed', 'failed')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS worktrees (
  id            TEXT PRIMARY KEY,
  ticket_id     TEXT NOT NULL REFERENCES tickets(id),
  path          TEXT NOT NULL,
  branch        TEXT NOT NULL,
  base_sha      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'merged', 'abandoned')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gate_events (
  id            TEXT PRIMARY KEY,
  ticket_id     TEXT NOT NULL REFERENCES tickets(id),
  worktree_id   TEXT REFERENCES worktrees(id),
  gate          TEXT NOT NULL CHECK (gate IN ('scope', 'ci', 'qa', 'hitl')),
  status        TEXT NOT NULL CHECK (status IN ('pending', 'passed', 'failed', 'skipped')),
  actor         TEXT,
  details       JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hotspot_leases (
  id            TEXT PRIMARY KEY,
  path          TEXT NOT NULL,
  ticket_id     TEXT NOT NULL REFERENCES tickets(id),
  worktree_id   TEXT NOT NULL REFERENCES worktrees(id),
  expires_at    TIMESTAMPTZ NOT NULL,
  released_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS releases (
  id            TEXT PRIMARY KEY,
  version       TEXT NOT NULL UNIQUE,
  branch        TEXT NOT NULL,
  tag           TEXT,
  status        TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning', 'open', 'frozen', 'released')),
  linear_cycle_id TEXT,
  ticket_ids    TEXT[] NOT NULL DEFAULT '{}',
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_linear_id ON tickets(linear_id);
CREATE INDEX IF NOT EXISTS idx_worktrees_ticket_id ON worktrees(ticket_id);
CREATE INDEX IF NOT EXISTS idx_worktrees_status ON worktrees(status);
CREATE INDEX IF NOT EXISTS idx_gate_events_ticket_id ON gate_events(ticket_id);
CREATE INDEX IF NOT EXISTS idx_hotspot_leases_path ON hotspot_leases(path);
CREATE INDEX IF NOT EXISTS idx_releases_status ON releases(status);
`;
