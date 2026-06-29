import { query, withTransaction } from '../db';
import { PoolClient } from 'pg';

export interface HotspotConfig {
  resource: string;
  reason: string;
}

export interface Lease {
  id: bigint;
  resource: string;
  ticketId: string;
  agentId: string;
  acquiredAt: Date;
  releasedAt?: Date;
}

export async function acquireLease(
  resource: string,
  ticketId: string,
  agentId: string
): Promise<Lease> {
  return withTransaction(async (client: PoolClient) => {
    const { rows: existing } = await client.query<{ id: string }>(
      `SELECT id FROM hotspot_leases
       WHERE resource = $1 AND released_at IS NULL`,
      [resource]
    );

    if (existing.length > 0) {
      throw new LeaseConflictError(resource, ticketId);
    }

    const { rows } = await client.query<{
      id: string;
      resource: string;
      ticket_id: string;
      agent_id: string;
      acquired_at: Date;
    }>(
      `INSERT INTO hotspot_leases (resource, ticket_id, agent_id)
       VALUES ($1, $2, $3)
       RETURNING id, resource, ticket_id, agent_id, acquired_at`,
      [resource, ticketId, agentId]
    );

    const row = rows[0]!;
    return {
      id: BigInt(row.id),
      resource: row.resource,
      ticketId: row.ticket_id,
      agentId: row.agent_id,
      acquiredAt: row.acquired_at,
    };
  });
}

export async function releaseLease(resource: string, ticketId: string): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE hotspot_leases
     SET released_at = NOW()
     WHERE resource = $1 AND ticket_id = $2 AND released_at IS NULL`,
    [resource, ticketId]
  );
  return (rowCount ?? 0) > 0;
}

export async function getActiveLease(resource: string): Promise<Lease | null> {
  const { rows } = await query<{
    id: string;
    resource: string;
    ticket_id: string;
    agent_id: string;
    acquired_at: Date;
  }>(
    `SELECT id, resource, ticket_id, agent_id, acquired_at
     FROM hotspot_leases
     WHERE resource = $1 AND released_at IS NULL
     LIMIT 1`,
    [resource]
  );

  if (!rows[0]) return null;
  const row = rows[0];
  return {
    id: BigInt(row.id),
    resource: row.resource,
    ticketId: row.ticket_id,
    agentId: row.agent_id,
    acquiredAt: row.acquired_at,
  };
}

export class LeaseConflictError extends Error {
  constructor(
    public readonly resource: string,
    public readonly requestingTicket: string
  ) {
    super(`Hotspot '${resource}' is already leased. Ticket '${requestingTicket}' must wait.`);
    this.name = 'LeaseConflictError';
  }
}
