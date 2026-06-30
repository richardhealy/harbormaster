import type { LinearClient, LinearTicket } from './index'

export interface SyncPool {
  query(text: string, values: unknown[]): Promise<unknown>
}

/** Mirrors Linear issues into the local `tickets` table so the scheduler, gates, and provenance log can reference ticket state without calling Linear on every read. */
export class TicketSyncer {
  constructor(
    private readonly pool: SyncPool,
    private readonly linear: LinearClient,
  ) {}

  /** Upserts a single ticket. Re-running with the same ticket overwrites the row (status, labels, etc. always reflect the latest fetch). */
  async syncTicket(ticket: LinearTicket): Promise<void> {
    await this.pool.query(
      `INSERT INTO tickets (id, title, status, priority, labels, assignee_id, linear_data, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (id) DO UPDATE SET
         title       = EXCLUDED.title,
         status      = EXCLUDED.status,
         priority    = EXCLUDED.priority,
         labels      = EXCLUDED.labels,
         assignee_id = EXCLUDED.assignee_id,
         linear_data = EXCLUDED.linear_data,
         updated_at  = NOW()`,
      [
        ticket.id,
        ticket.title,
        ticket.state.name,
        ticket.priority,
        ticket.labels.map((l) => l.name),
        ticket.assignee?.id ?? null,
        ticket,
      ],
    )
  }

  /** Fetches and syncs every issue for a team. A failure on one ticket is counted and skipped rather than aborting the whole batch. */
  async syncTeamTickets(
    teamId: string,
    options: { limit?: number } = {},
  ): Promise<{ synced: number; errors: number }> {
    const tickets = await this.linear.listTeamIssues(teamId, options)
    let synced = 0
    let errors = 0
    for (const ticket of tickets) {
      try {
        await this.syncTicket(ticket)
        synced++
      } catch {
        errors++
      }
    }
    return { synced, errors }
  }
}
