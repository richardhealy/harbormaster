/* eslint-disable */
'use strict';

exports.up = (pgm) => {
  pgm.createTable('releases', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    version: { type: 'varchar(50)', notNull: true, unique: true },
    branch: { type: 'varchar(255)', notNull: true },
    status: { type: 'varchar(50)', notNull: true, default: "'draft'" },
    linear_cycle_id: { type: 'varchar(255)' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    released_at: { type: 'timestamptz' },
  });

  pgm.createTable('tickets', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    linear_id: { type: 'varchar(255)', notNull: true, unique: true },
    title: { type: 'text', notNull: true },
    status: { type: 'varchar(50)', notNull: true, default: "'pending'" },
    priority: { type: 'integer', notNull: true, default: 3 },
    release_id: { type: 'uuid', references: 'releases' },
    estimated_impact: { type: 'jsonb' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('dispatches', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    ticket_id: { type: 'uuid', notNull: true, references: 'tickets' },
    agent_id: { type: 'varchar(255)', notNull: true },
    worktree_path: { type: 'text' },
    branch: { type: 'varchar(255)' },
    status: { type: 'varchar(50)', notNull: true, default: "'dispatched'" },
    attempt: { type: 'integer', notNull: true, default: 1 },
    dispatched_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    completed_at: { type: 'timestamptz' },
  });

  pgm.createTable('leases', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    hotspot: { type: 'varchar(255)', notNull: true, unique: true },
    dispatch_id: { type: 'uuid', notNull: true, references: 'dispatches' },
    acquired_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    expires_at: { type: 'timestamptz', notNull: true },
    released_at: { type: 'timestamptz' },
  });

  pgm.createTable('gate_decisions', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    dispatch_id: { type: 'uuid', notNull: true, references: 'dispatches' },
    gate: { type: 'varchar(50)', notNull: true },
    status: { type: 'varchar(50)', notNull: true },
    decided_by: { type: 'varchar(255)' },
    notes: { type: 'text' },
    decided_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('audit_log', {
    id: { type: 'bigserial', primaryKey: true },
    event_type: { type: 'varchar(100)', notNull: true },
    actor: { type: 'varchar(255)', notNull: true },
    payload: { type: 'jsonb', notNull: true, default: "'{}'" },
    ticket_id: { type: 'uuid', references: 'tickets' },
    dispatch_id: { type: 'uuid', references: 'dispatches' },
    release_id: { type: 'uuid', references: 'releases' },
    occurred_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('tickets', 'linear_id');
  pgm.createIndex('tickets', 'release_id');
  pgm.createIndex('dispatches', 'ticket_id');
  pgm.createIndex('dispatches', 'status');
  pgm.createIndex('audit_log', 'event_type');
  pgm.createIndex('audit_log', 'ticket_id');
  pgm.createIndex('audit_log', 'occurred_at');
};

exports.down = (pgm) => {
  pgm.dropTable('audit_log');
  pgm.dropTable('gate_decisions');
  pgm.dropTable('leases');
  pgm.dropTable('dispatches');
  pgm.dropTable('tickets');
  pgm.dropTable('releases');
};
