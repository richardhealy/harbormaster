import type { LinearClient, LinearTicket } from './index'

/**
 * Minimal query surface `TicketSyncer` needs from a database pool. Kept
 * narrow (rather than depending on a concrete pg `Pool` type) so it can be
 * faked in tests.
 */
export interface SyncPool {
  query(text: string, values: unknown[]): Promise<unknown>
}

/**
 * Mirrors Linear tickets into harbormaster's own `tickets` table. The
 * scheduler and impact estimator read from this local copy instead of
 * calling Linear's API on every scheduling pass, which would be slow and
 * rate-limit-prone given how frequently those components run.
 */
export class TicketSyncer {
  constructor(
    private readonly pool: SyncPool,
    private readonly linear: LinearClient,
  ) {}

  /**
   * Upserts a single ticket's current Linear state into the `tickets`
   * table, keyed by Linear's ticket id. The full raw ticket is also stored
   * (`linear_data`) alongside the flattened columns used for querying.
   */
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
   * Fetches a team's issues from Linear and upserts each one via
   * `syncTicket`. Failures on individual tickets are counted rather than
   * thrown, so one bad ticket can't abort the sync for the rest of the
   * team — callers get a `{synced, errors}` summary to decide whether to
   * retry or alert.
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
