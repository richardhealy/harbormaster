import type { ImpactSurface } from '../impact'
import { computeOverlap } from '../impact'
import type {
  ScheduledGroup,
  DispatchPlan,
  DispatchWave,
  SchedulerTicket,
  SchedulerConfig,
} from './types'
import { DEFAULT_SCHEDULER_CONFIG } from './types'

export type {
  ScheduledGroup,
  DispatchPlan,
  DispatchWave,
  SchedulerTicket,
  SchedulerConfig,
} from './types'
export { DEFAULT_SCHEDULER_CONFIG } from './types'

/**
 * Conflict-aware scheduler.
 *
 * Accepts a list of tickets with pre-computed impact surfaces and produces a
 * DispatchPlan: ordered waves of groups where groups within a wave are safe to
 * run in parallel and groups across waves are sequenced.
 *
 * Decision rules (applied per ticket-pair by Jaccard overlap score):
 *   overlap >= mergeThreshold  → merge both into one agent job
 *   0 < overlap < merge        → sequence (the later ticket runs after the earlier)
 *   overlap == 0               → parallel (safe to run at the same time)
 */
export class Scheduler {
  constructor(private readonly config: SchedulerConfig = DEFAULT_SCHEDULER_CONFIG) {}

  /**
   * Produce a dispatch plan for the given tickets.
   *
   * @param tickets - Tickets to schedule, in priority order (lower priority value = first).
   * @param surfaces - Impact surface for each ticketId; unknown tickets are treated as zero impact.
   */
  plan(tickets: SchedulerTicket[], surfaces: Map<string, ImpactSurface>): DispatchPlan {
    if (tickets.length === 0) {
      return { waves: [], groups: [], mergeCount: 0, ticketCount: 0, createdAt: new Date() }
    }

    // Sort by priority (lower value = higher priority); stable sort preserves input order for ties
    const sorted = [...tickets].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))

    // Step 1: identify merge clusters via union-find
    const groups = this.buildGroups(sorted, surfaces)

    // Step 2: build a dependency DAG between groups based on overlap
    const groupSurfaces = buildGroupSurfaces(groups, surfaces)
    const waves = this.buildWaves(groups, groupSurfaces)

    return {
      waves,
      groups,
      mergeCount: groups.filter(g => g.decision === 'merge').length,
      ticketCount: tickets.length,
      createdAt: new Date(),
    }
  }

  /** Cluster tickets that exceed the merge threshold into single groups */
  private buildGroups(
    tickets: SchedulerTicket[],
    surfaces: Map<string, ImpactSurface>,
  ): ScheduledGroup[] {
    const { mergeThreshold } = this.config

    // Union-Find
    const parent = new Map<string, string>(tickets.map(t => [t.ticketId, t.ticketId]))
    const overlapScore = new Map<string, number>() // edge key → score

    const find = (id: string): string => {
      const p = parent.get(id)!
      if (p === id) return id
      const root = find(p)
      parent.set(id, root)
      return root
    }
    const union = (a: string, b: string) => {
      parent.set(find(a), find(b))
    }
    const edgeKey = (a: string, b: string) => [a, b].sort().join('|')

    for (let i = 0; i < tickets.length; i++) {
      for (let j = i + 1; j < tickets.length; j++) {
        const si = surfaces.get(tickets[i].ticketId)
        const sj = surfaces.get(tickets[j].ticketId)
        if (!si || !sj) continue
        const score = computeOverlap(si, sj)
        overlapScore.set(edgeKey(tickets[i].ticketId, tickets[j].ticketId), score)
        if (score >= mergeThreshold) {
          union(tickets[i].ticketId, tickets[j].ticketId)
        }
      }
    }

    // Build clusters from union-find roots
    const clusters = new Map<string, string[]>()
    for (const ticket of tickets) {
      const root = find(ticket.ticketId)
      const members = clusters.get(root) ?? []
      members.push(ticket.ticketId)
      clusters.set(root, members)
    }

    const groups: ScheduledGroup[] = []
    for (const [, members] of clusters) {
      if (members.length === 1) {
        groups.push({
          id: members[0],
          tickets: members,
          decision: 'parallel', // updated during wave building
          reason: 'Single ticket; no merge required',
        })
      } else {
        // Find the highest overlap score among merged members for reporting
        let maxScore = 0
        for (let i = 0; i < members.length; i++) {
          for (let j = i + 1; j < members.length; j++) {
            const score = overlapScore.get(edgeKey(members[i], members[j])) ?? 0
            if (score > maxScore) maxScore = score
          }
        }
        groups.push({
          id: members.join('+'),
          tickets: members,
          decision: 'merge',
          reason: `Tickets share significant code overlap (score ${maxScore.toFixed(2)} ≥ threshold ${this.config.mergeThreshold})`,
          overlapScore: maxScore,
        })
      }
    }

    return groups
  }

  /**
   * Produce ordered waves from groups.
   * Uses Kahn's topological sort: groups with overlap above sequenceThreshold
   * have a "depends on previous" edge.
   */
  private buildWaves(
    groups: ScheduledGroup[],
    groupSurfaces: Map<string, ImpactSurface>,
  ): DispatchWave[] {
    const { sequenceThreshold } = this.config

    // Build adjacency: earlier group → set of later groups that depend on it
    const dependents = new Map<string, Set<string>>(groups.map(g => [g.id, new Set()]))
    const inDegree = new Map<string, number>(groups.map(g => [g.id, 0]))

    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const si = groupSurfaces.get(groups[i].id)
        const sj = groupSurfaces.get(groups[j].id)
        if (!si || !sj) continue
        const score = computeOverlap(si, sj)
        if (score > sequenceThreshold) {
          // groups[i] must complete before groups[j]
          dependents.get(groups[i].id)!.add(groups[j].id)
          inDegree.set(groups[j].id, (inDegree.get(groups[j].id) ?? 0) + 1)

          // Mark single-ticket groups that must sequence
          if (groups[j].decision !== 'merge') {
            groups[j].decision = 'sequence'
            groups[j].reason = `Overlaps with ${groups[i].id} (score ${score.toFixed(2)})`
            groups[j].overlapScore = score
          }
        }
      }
    }

    // Kahn's BFS topological sort → waves
    const waves: DispatchWave[] = []
    let current = groups.filter(g => inDegree.get(g.id) === 0)

    while (current.length > 0) {
      // Mark groups in this wave as parallel when there are multiple and they are single-ticket
      for (const g of current) {
        if (g.decision !== 'merge' && g.decision !== 'sequence') {
          g.decision = current.length > 1 ? 'parallel' : 'sequence'
          if (current.length > 1) g.reason = 'No overlapping groups; safe to run concurrently'
        }
      }
      waves.push([...current])

      const next: ScheduledGroup[] = []
      for (const g of current) {
        for (const dep of dependents.get(g.id) ?? []) {
          const newDeg = (inDegree.get(dep) ?? 0) - 1
          inDegree.set(dep, newDeg)
          if (newDeg === 0) {
            const depGroup = groups.find(gr => gr.id === dep)
            if (depGroup) next.push(depGroup)
          }
        }
      }
      current = next
    }

    return waves
  }
}

/** Build a combined impact surface for each group (union of its tickets' surfaces) */
function buildGroupSurfaces(
  groups: ScheduledGroup[],
  surfaces: Map<string, ImpactSurface>,
): Map<string, ImpactSurface> {
  const result = new Map<string, ImpactSurface>()

  for (const group of groups) {
    const allFiles = new Set<string>()
    const allDirs = new Set<string>()
    const allDomains = new Set<string>()

    for (const ticketId of group.tickets) {
      const s = surfaces.get(ticketId)
      if (!s) continue
      s.files.forEach(f => allFiles.add(f))
      s.directories.forEach(d => allDirs.add(d))
      s.domains.forEach(d => allDomains.add(d))
    }

    const combined: ImpactSurface = {
      ticketId: group.id,
      files: [...allFiles],
      directories: [...allDirs],
      domains: [...allDomains],
      confidence: 1.0,
    }
    group.combinedSurface = combined
    result.set(group.id, combined)
  }

  return result
}
