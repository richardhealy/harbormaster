import { buildDispatchPlan, computeOverlap, TicketImpact } from '../src/scheduler';

const makeTicket = (
  id: string,
  files: string[],
  modules: string[] = [],
  risk: 'low' | 'medium' | 'high' = 'low'
): TicketImpact => ({ ticketId: id, files, modules, estimatedRisk: risk });

describe('computeOverlap', () => {
  it('returns 0 for non-overlapping tickets', () => {
    const a = makeTicket('T1', ['src/auth.ts', 'src/user.ts']);
    const b = makeTicket('T2', ['src/scheduler.ts', 'src/queue.ts']);
    expect(computeOverlap(a, b)).toBe(0);
  });

  it('returns 1 for identical tickets', () => {
    const a = makeTicket('T1', ['src/auth.ts'], ['src/']);
    const b = makeTicket('T2', ['src/auth.ts'], ['src/']);
    expect(computeOverlap(a, b)).toBe(1);
  });

  it('returns partial overlap', () => {
    const a = makeTicket('T1', ['shared.ts', 'a.ts']);
    const b = makeTicket('T2', ['shared.ts', 'b.ts']);
    const overlap = computeOverlap(a, b);
    expect(overlap).toBeGreaterThan(0);
    expect(overlap).toBeLessThan(1);
  });

  it('returns 0 for empty tickets', () => {
    const a = makeTicket('T1', []);
    const b = makeTicket('T2', []);
    expect(computeOverlap(a, b)).toBe(0);
  });
});

describe('buildDispatchPlan', () => {
  it('marks non-overlapping tickets as parallel', () => {
    const tickets = [
      makeTicket('T1', ['src/auth.ts']),
      makeTicket('T2', ['src/queue.ts']),
      makeTicket('T3', ['docs/readme.md']),
    ];
    const plan = buildDispatchPlan(tickets);
    const actions = plan.decisions.map((d) => d.action);
    expect(actions.every((a) => a === 'parallel')).toBe(true);
  });

  it('merges highly overlapping tickets', () => {
    const tickets = [
      makeTicket('T1', ['src/auth.ts', 'src/user.ts', 'src/session.ts']),
      makeTicket('T2', ['src/auth.ts', 'src/user.ts', 'src/session.ts']),
    ];
    const plan = buildDispatchPlan(tickets, { mergeThreshold: 0.7 });
    const t2decision = plan.decisions.find((d) => d.ticketId === 'T2');
    expect(t2decision?.action).toBe('merge');
  });

  it('sequences moderately overlapping tickets', () => {
    const tickets = [
      makeTicket('T1', ['shared.ts', 'a.ts', 'b.ts', 'c.ts']),
      makeTicket('T2', ['shared.ts', 'd.ts', 'e.ts', 'f.ts']),
    ];
    const plan = buildDispatchPlan(tickets, { mergeThreshold: 0.7, sequenceThreshold: 0.1 });
    const t1decision = plan.decisions.find((d) => d.ticketId === 'T1');
    expect(t1decision?.action).toBe('sequence');
  });

  it('handles empty ticket list', () => {
    const plan = buildDispatchPlan([]);
    expect(plan.decisions).toHaveLength(0);
    expect(plan.groups).toHaveLength(0);
  });

  it('handles single ticket', () => {
    const plan = buildDispatchPlan([makeTicket('T1', ['src/a.ts'])]);
    expect(plan.decisions).toHaveLength(1);
    expect(plan.decisions[0]!.action).toBe('parallel');
  });

  it('produces groups for all tickets', () => {
    const tickets = [
      makeTicket('T1', ['a.ts']),
      makeTicket('T2', ['b.ts']),
      makeTicket('T3', ['c.ts']),
    ];
    const plan = buildDispatchPlan(tickets);
    const allTicketsInGroups = plan.groups.flatMap((g) => g.tickets);
    for (const t of tickets) {
      expect(allTicketsInGroups).toContain(t.ticketId);
    }
  });
});
