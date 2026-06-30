import type { LinearClient, LinearTicket } from './index'

export interface SyncPool {
  query(text: string, values: unknown[]): Promise<unknown>
}

/** Mirrors Linear tickets into the local `tickets` table so the scheduler and gates can read them without a live API call per lookup. */
export class TicketSyncer {
  constructor(
    private readonly pool: SyncPool,
    private readonly linear: LinearClient,
  ) {}

  /** Upserts a single ticket, keyed by Linear's `id`. */
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

  /**
   * Fetches all of a team's issues and upserts each one independently — a single
   * ticket failing doesn't abort the batch, it just increments `errors` and the
   * sync continues.
   */
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
