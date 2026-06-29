import { randomUUID } from "crypto";
import type { TicketRef, DispatchPlan, SchedulerResult } from "./types.js";

/**
 * Computes the overlap between two sets of file paths.
 * Returns a value in [0, 1]: 0 = disjoint, 1 = identical.
 */
export function overlapScore(pathsA: string[], pathsB: string[]): number {
  if (pathsA.length === 0 || pathsB.length === 0) return 0;
  const setA = new Set(pathsA);
  const intersection = pathsB.filter((p) => setA.has(p));
  const union = new Set([...pathsA, ...pathsB]);
  return intersection.length / union.size;
}

const MERGE_THRESHOLD = 0.6; // high overlap → merge into one job
const SEQUENCE_THRESHOLD = 0.1; // any overlap → sequence

/**
 * Produces a dispatch plan for a list of tickets.
 *
 * Decision rules (applied pairwise):
 *   overlap ≥ 0.6  → merge into one job (single agent handles both tickets)
 *   overlap ≥ 0.1  → sequence (run one after the other)
 *   overlap < 0.1  → parallel (safe to run concurrently)
 *
 * This is the core of the collision-avoidance strategy: most conflicts never
 * happen because we never dispatch two overlapping tickets at the same time.
 */
export function buildDispatchPlans(tickets: TicketRef[]): SchedulerResult {
  if (tickets.length === 0) {
    return { plans: [], blocked: [] };
  }

  if (tickets.length === 1) {
    return {
      plans: [
        {
          id: randomUUID(),
          ticketIds: [tickets[0]!.id],
          action: "parallel",
          reason: "single ticket, no conflict possible",
          impactScore: 0,
        },
      ],
      blocked: [],
    };
  }

  const plans: DispatchPlan[] = [];
  const assigned = new Set<string>();

  // Sort by priority descending so high-priority tickets pair first
  const sorted = [...tickets].sort((a, b) => b.priority - a.priority);

  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    if (assigned.has(a.id)) continue;

    let bestMatch: TicketRef | null = null;
    let bestScore = -1;

    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j]!;
      if (assigned.has(b.id)) continue;
      const score = overlapScore(a.impactPaths, b.impactPaths);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = b;
      }
    }

    if (bestMatch === null) {
      plans.push({
        id: randomUUID(),
        ticketIds: [a.id],
        action: "parallel",
        reason: "no other tickets to compare",
        impactScore: 0,
      });
      assigned.add(a.id);
      continue;
    }

    if (bestScore >= MERGE_THRESHOLD) {
      plans.push({
        id: randomUUID(),
        ticketIds: [a.id, bestMatch.id],
        action: "merge",
        reason: `high overlap (${(bestScore * 100).toFixed(0)}%) — combined into one job`,
        impactScore: bestScore,
      });
      assigned.add(a.id);
      assigned.add(bestMatch.id);
    } else if (bestScore >= SEQUENCE_THRESHOLD) {
      plans.push({
        id: randomUUID(),
        ticketIds: [a.id, bestMatch.id],
        action: "sequence",
        reason: `partial overlap (${(bestScore * 100).toFixed(0)}%) — run in sequence`,
        impactScore: bestScore,
      });
      assigned.add(a.id);
      assigned.add(bestMatch.id);
    } else {
      plans.push({
        id: randomUUID(),
        ticketIds: [a.id],
        action: "parallel",
        reason: `no significant overlap with any other ticket`,
        impactScore: 0,
      });
      assigned.add(a.id);
    }
  }

  // Any ticket not yet assigned gets its own parallel plan
  for (const ticket of sorted) {
    if (!assigned.has(ticket.id)) {
      plans.push({
        id: randomUUID(),
        ticketIds: [ticket.id],
        action: "parallel",
        reason: "no conflict found",
        impactScore: 0,
      });
    }
  }

  return { plans, blocked: [] };
}
