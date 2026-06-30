import type { LinearClient, LinearTicket } from './index'

/** Subset of `pg.Pool` the syncer needs; keeps it testable without a real database. */
export interface SyncPool {
  query(text: string, values: unknown[]): Promise<unknown>
}

/** Mirrors Linear tickets into the local `tickets` table so the scheduler and gates can query them without a live API call. */
export class TicketSyncer {
  constructor(
    private readonly pool: SyncPool,
    private readonly linear: LinearClient,
  ) {}

  /** Upserts a single ticket by id, keyed on the Linear ticket id. */
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
   * Fetches all of a team's tickets from Linear and upserts each one
   * independently — a single failing row doesn't abort the sweep, it's
   * counted in `errors` so the caller can decide whether to retry.
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
