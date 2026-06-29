import { TicketId, DispatchPlan, DispatchDecision } from '../types';

export interface ImpactSurface {
  files: string[];
  modules: string[];
}

export function planDispatch(
  tickets: Array<{ id: TicketId; impact: ImpactSurface }>,
): DispatchPlan[] {
  if (tickets.length === 0) return [];

  const plans: DispatchPlan[] = [];
  const assigned = new Set<TicketId>();

  for (let i = 0; i < tickets.length; i++) {
    if (assigned.has(tickets[i].id)) continue;

    const overlapping: TicketId[] = [tickets[i].id];

    for (let j = i + 1; j < tickets.length; j++) {
      if (assigned.has(tickets[j].id)) continue;
      if (impactOverlaps(tickets[i].impact, tickets[j].impact)) {
        overlapping.push(tickets[j].id);
      }
    }

    overlapping.forEach((id) => assigned.add(id));

    const decision: DispatchDecision = overlapping.length > 1 ? 'sequential' : 'parallel';
    plans.push({
      decision,
      tickets: overlapping,
      reason:
        overlapping.length > 1
          ? `Tickets share impact surface; scheduling sequentially to avoid collision`
          : `No overlap detected; can run in parallel`,
    });
  }

  return plans;
}

function impactOverlaps(a: ImpactSurface, b: ImpactSurface): boolean {
  const aFiles = new Set(a.files);
  const bFiles = new Set(b.files);
  for (const f of aFiles) {
    if (bFiles.has(f)) return true;
  }
  const aModules = new Set(a.modules);
  const bModules = new Set(b.modules);
  for (const m of aModules) {
    if (bModules.has(m)) return true;
  }
  return false;
}
