import { randomUUID } from "crypto";
import type { DbClient } from "../db/client.js";

export interface HotspotConfig {
  paths: string[];
  leaseDurationMs: number;
}

export interface AcquireResult {
  acquired: boolean;
  leaseId?: string;
  heldBy?: string;
}

/**
 * Attempts to acquire an advisory lease for a hotspot path.
 *
 * Uses a database row as the lease record. If a live (non-expired) lease exists
 * for the path, acquisition fails. Otherwise a new lease is inserted.
 *
 * This is the narrow advisory-lock layer for genuinely un-mergeable spots
 * (migrations, shared contracts). Most of the repo stays lock-free.
 */
export async function acquireLease(
  db: DbClient,
  path: string,
  ticketId: string,
  worktreeId: string,
  durationMs: number
): Promise<AcquireResult> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationMs);

  // Clean expired leases first
  await db.query(
    `DELETE FROM hotspot_leases WHERE path = $1 AND (released_at IS NOT NULL OR expires_at < $2)`,
    [path, now]
  );

  // Check for an active lease
  const existing = await db.query(
    `SELECT id, ticket_id FROM hotspot_leases WHERE path = $1 AND released_at IS NULL AND expires_at >= $2 LIMIT 1`,
    [path, now]
  );

  if (existing.rows.length > 0) {
    return {
      acquired: false,
      heldBy: existing.rows[0].ticket_id as string,
    };
  }

  const leaseId = randomUUID();
  await db.query(
    `INSERT INTO hotspot_leases (id, path, ticket_id, worktree_id, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [leaseId, path, ticketId, worktreeId, expiresAt]
  );

  return { acquired: true, leaseId };
}

/**
 * Releases an advisory lease by ID.
 */
export async function releaseLease(
  db: DbClient,
  leaseId: string
): Promise<void> {
  await db.query(
    `UPDATE hotspot_leases SET released_at = NOW() WHERE id = $1`,
    [leaseId]
  );
}

/**
 * Returns true if any of the given paths are under an active hotspot lease
 * held by a ticket other than `ownTicketId`.
 */
export async function hasConflictingLease(
  db: DbClient,
  paths: string[],
  ownTicketId: string
): Promise<boolean> {
  if (paths.length === 0) return false;
  const now = new Date();
  const result = await db.query(
    `SELECT 1 FROM hotspot_leases
     WHERE path = ANY($1)
       AND ticket_id != $2
       AND released_at IS NULL
       AND expires_at >= $3
     LIMIT 1`,
    [paths, ownTicketId, now]
  );
  return result.rows.length > 0;
}
