import { analyseOverlap } from '../impact/estimator'
import type { OverlapAnalysis } from '../impact/types'
import type {
  TicketWithImpact,
  DispatchPlan,
  DispatchStage,
  DispatchGroup,
  SchedulerConfig,
} from './types'
import { DEFAULT_SCHEDULER_CONFIG } from './types'

/** Path-compressed Union-Find for clustering merge-level overlapping tickets */
class UnionFind {
  private readonly parent = new Map<string, string>()

  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x)
    const p = this.parent.get(x)!
    if (p !== x) this.parent.set(x, this.find(p))
    return this.parent.get(x)!
  }

  union(x: string, y: string): void {
    this.parent.set(this.find(x), this.find(y))
  }
}

/**
 * Plans the dispatch order for a set of tickets based on their estimated
 * impact surfaces.
 *
 * ### Algorithm
 *
 * 1. Compute all O(n²) pairwise impact overlaps.
 * 2. Use Union-Find to cluster tickets whose overlap ratio exceeds
 *    `mergeThreshold` — they become a single merged job for one agent.
 * 3. Build a DAG of ordering constraints between clusters: if two clusters
 *    have any overlap above `parallelThreshold` but below `mergeThreshold`,
 *    the earlier-indexed cluster must complete before the later one starts.
 * 4. Run Kahn's topological sort to partition clusters into stages.
 *    All clusters in the same stage can run concurrently; stage N runs
 *    only after stage N-1 is fully done.
 * 5. Emit a `DispatchPlan` with one `DispatchStage` per wave.
 *
 * The result guarantees that two tickets with any meaningful impact overlap
 * never run concurrently unless they have been merged into one job.
 */
export class Scheduler {
  private readonly cfg: SchedulerConfig

  constructor(config?: Partial<SchedulerConfig>) {
    this.cfg = { ...DEFAULT_SCHEDULER_CONFIG, ...config }
  }

  plan(tickets: TicketWithImpact[]): DispatchPlan {
    if (tickets.length === 0) return { stages: [], overlaps: [] }

    const { mergeThreshold, parallelThreshold } = this.cfg

    // ── Step 1: pairwise overlaps ────────────────────────────────────────────
    const overlaps: OverlapAnalysis[] = []
    for (let i = 0; i < tickets.length; i++) {
      for (let j = i + 1; j < tickets.length; j++) {
        overlaps.push(analyseOverlap(tickets[i].impact, tickets[j].impact))
      }
    }

    // ── Step 2: merge-level clusters ─────────────────────────────────────────
    const uf = new UnionFind()
    for (const ov of overlaps) {
      if (ov.overlapRatio > mergeThreshold) {
        uf.union(ov.ticketA, ov.ticketB)
      }
    }

    // Build cluster map: representative ID → member ticket IDs (input order)
    const clusterMap = new Map<string, string[]>()
    for (const t of tickets) {
      const rep = uf.find(t.ticketId)
      const members = clusterMap.get(rep) ?? []
      members.push(t.ticketId)
      clusterMap.set(rep, members)
    }

    const reps = [...clusterMap.keys()]
    // Stable ordering index used to deterministically break ordering ties
    const repOrder = new Map(reps.map((r, i) => [r, i]))

    // ── Step 3: sequence constraints (DAG edges) ─────────────────────────────
    const dependsOn = new Map<string, Set<string>>(reps.map(r => [r, new Set()]))

    for (const ov of overlaps) {
      const repA = uf.find(ov.ticketA)
      const repB = uf.find(ov.ticketB)
      if (repA === repB) continue                       // same cluster, already merged
      if (ov.overlapRatio <= parallelThreshold) continue // safe to parallelize

      // The cluster with the lower input-order index runs first
      const [first, second] =
        repOrder.get(repA)! < repOrder.get(repB)!
          ? [repA, repB]
          : [repB, repA]
      dependsOn.get(second)!.add(first)
    }

    // ── Step 4: Kahn's topological sort → waves ──────────────────────────────
    const inDegree = new Map(reps.map(r => [r, dependsOn.get(r)!.size]))
    const remaining = new Set(reps)
    const waves: string[][] = []

    while (remaining.size > 0) {
      const ready = [...remaining].filter(r => inDegree.get(r)! === 0)
      if (ready.length === 0) {
        // Cycle (should be impossible with stable ordering) — degrade gracefully
        waves.push([...remaining])
        break
      }
      waves.push(ready)
      for (const r of ready) {
        remaining.delete(r)
        for (const other of remaining) {
          if (dependsOn.get(other)!.has(r)) {
            inDegree.set(other, inDegree.get(other)! - 1)
          }
        }
      }
    }

    // ── Step 5: build output ─────────────────────────────────────────────────
    const stages: DispatchStage[] = waves.map((wave, stageIdx) => {
      const groups: DispatchGroup[] = wave.map(rep => {
        const members = clusterMap.get(rep)!

        if (members.length > 1) {
          return {
            tickets: members,
            decision: 'merge' as const,
            reason: `Impact surfaces share >${Math.round(mergeThreshold * 100)}% of the smaller surface; dispatched as one job to avoid collision`,
          }
        }

        const isConstrained = stageIdx > 0
        return {
          tickets: members,
          decision: 'parallel' as const,
          reason: isConstrained
            ? `Overlapping impact with a ticket in stage ${stageIdx - 1}; runs after that stage completes`
            : 'No meaningful impact overlap with other tickets; can start immediately',
        }
      })

      return { index: stageIdx, groups }
    })

    return { stages, overlaps }
  }
}
