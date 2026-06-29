export interface TicketImpact {
  ticketId: string;
  files: string[];
  modules: string[];
  estimatedRisk: 'low' | 'medium' | 'high';
}

export type DispatchAction = 'parallel' | 'sequence' | 'merge';

export interface DispatchDecision {
  ticketId: string;
  action: DispatchAction;
  groupWith?: string[];
  reason: string;
}

export interface DispatchPlan {
  decisions: DispatchDecision[];
  groups: TicketGroup[];
}

export interface TicketGroup {
  id: string;
  tickets: string[];
  runOrder: 'parallel' | 'sequential';
}

export function computeOverlap(a: TicketImpact, b: TicketImpact): number {
  const setA = new Set([...a.files, ...a.modules]);
  const setB = new Set([...b.files, ...b.modules]);
  let overlap = 0;
  for (const item of setA) {
    if (setB.has(item)) overlap++;
  }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : overlap / union;
}

export interface SchedulerOptions {
  mergeThreshold?: number;
  sequenceThreshold?: number;
}

export function buildDispatchPlan(
  tickets: TicketImpact[],
  opts: SchedulerOptions = {}
): DispatchPlan {
  const mergeThreshold = opts.mergeThreshold ?? 0.7;
  const sequenceThreshold = opts.sequenceThreshold ?? 0.2;

  const decisions: DispatchDecision[] = [];
  const merged = new Set<string>();
  const sequenced = new Map<string, string[]>();
  const groups: TicketGroup[] = [];

  for (let i = 0; i < tickets.length; i++) {
    const a = tickets[i]!;
    if (merged.has(a.ticketId)) continue;

    const mergeGroup: string[] = [a.ticketId];
    const sequenceAfter: string[] = [];

    for (let j = i + 1; j < tickets.length; j++) {
      const b = tickets[j]!;
      if (merged.has(b.ticketId)) continue;

      const overlap = computeOverlap(a, b);

      if (overlap >= mergeThreshold) {
        mergeGroup.push(b.ticketId);
        merged.add(b.ticketId);
        decisions.push({
          ticketId: b.ticketId,
          action: 'merge',
          groupWith: [a.ticketId],
          reason: `High overlap (${(overlap * 100).toFixed(0)}%) with ${a.ticketId} — dispatched as one job`,
        });
      } else if (overlap >= sequenceThreshold) {
        sequenceAfter.push(b.ticketId);
      }
    }

    merged.add(a.ticketId);

    if (mergeGroup.length > 1) {
      decisions.push({
        ticketId: a.ticketId,
        action: 'merge',
        groupWith: mergeGroup.slice(1),
        reason: `Merged with ${mergeGroup.slice(1).join(', ')} due to high impact overlap`,
      });
      groups.push({ id: `merge-${a.ticketId}`, tickets: mergeGroup, runOrder: 'parallel' });
    } else if (sequenceAfter.length > 0) {
      sequenced.set(a.ticketId, sequenceAfter);
      decisions.push({
        ticketId: a.ticketId,
        action: 'sequence',
        groupWith: sequenceAfter,
        reason: `Moderate overlap with ${sequenceAfter.join(', ')} — run sequentially`,
      });
      groups.push({ id: `seq-${a.ticketId}`, tickets: [a.ticketId, ...sequenceAfter], runOrder: 'sequential' });
    } else {
      decisions.push({
        ticketId: a.ticketId,
        action: 'parallel',
        reason: 'No significant overlap detected — safe to run concurrently',
      });
      if (!groups.some((g) => g.tickets.includes(a.ticketId))) {
        groups.push({ id: `par-${a.ticketId}`, tickets: [a.ticketId], runOrder: 'parallel' });
      }
    }
  }

  return { decisions, groups };
}
