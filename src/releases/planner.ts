import type { LinearClient } from '../integrations/linear/index'
import type { LinearTicket } from '../integrations/linear/types'
import type { ReleasePlan, LinearIssueFilter } from './types'
import { ManifestBuilder } from './manifest'
import { ReleaseNotesGenerator } from './notes'

export class ReleasePlanner {
  private readonly manifestBuilder = new ManifestBuilder()
  private readonly notesGenerator = new ReleaseNotesGenerator()

  constructor(private readonly linear: LinearClient) {}

  async planFromTeamIssues(
    teamId: string,
    version: string,
    branch: string,
    options: { filter?: LinearIssueFilter; limit?: number; linearCycleId?: string } = {},
  ): Promise<ReleasePlan> {
    const tickets = await this.linear.listTeamIssues(teamId, {
      filter: options.filter,
      limit: options.limit,
    })
    return this.buildPlan(version, branch, tickets, options.linearCycleId)
  }

  planFromTickets(
    tickets: LinearTicket[],
    version: string,
    branch: string,
    linearCycleId?: string,
  ): ReleasePlan {
    return this.buildPlan(version, branch, tickets, linearCycleId)
  }

  private buildPlan(
    version: string,
    branch: string,
    tickets: LinearTicket[],
    linearCycleId?: string,
  ): ReleasePlan {
    const manifest = this.manifestBuilder.build(version, tickets)
    const notes = this.notesGenerator.generate(manifest)
    return { version, branch, linearCycleId, tickets, manifest, notes }
  }
}
