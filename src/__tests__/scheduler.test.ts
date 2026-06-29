import { describe, it, expect } from 'vitest';
import { planDispatch } from '../scheduler';

describe('planDispatch', () => {
  it('returns empty array for no tickets', () => {
    expect(planDispatch([])).toEqual([]);
  });

  it('marks non-overlapping tickets as parallel', () => {
    const tickets = [
      { id: 'A', impact: { files: ['src/a.ts'], modules: ['moduleA'] } },
      { id: 'B', impact: { files: ['src/b.ts'], modules: ['moduleB'] } },
    ];
    const plans = planDispatch(tickets);
    expect(plans).toHaveLength(2);
    expect(plans[0].decision).toBe('parallel');
    expect(plans[1].decision).toBe('parallel');
  });

  it('marks overlapping tickets (shared file) as sequential', () => {
    const tickets = [
      { id: 'A', impact: { files: ['src/shared.ts'], modules: [] } },
      { id: 'B', impact: { files: ['src/shared.ts'], modules: [] } },
    ];
    const plans = planDispatch(tickets);
    expect(plans).toHaveLength(1);
    expect(plans[0].decision).toBe('sequential');
    expect(plans[0].tickets).toContain('A');
    expect(plans[0].tickets).toContain('B');
  });

  it('marks overlapping tickets (shared module) as sequential', () => {
    const tickets = [
      { id: 'X', impact: { files: [], modules: ['auth'] } },
      { id: 'Y', impact: { files: [], modules: ['auth'] } },
    ];
    const plans = planDispatch(tickets);
    expect(plans).toHaveLength(1);
    expect(plans[0].decision).toBe('sequential');
  });

  it('handles a mix of overlapping and non-overlapping tickets', () => {
    const tickets = [
      { id: 'A', impact: { files: ['src/shared.ts'], modules: [] } },
      { id: 'B', impact: { files: ['src/shared.ts'], modules: [] } },
      { id: 'C', impact: { files: ['src/other.ts'], modules: ['other'] } },
    ];
    const plans = planDispatch(tickets);
    const seqPlan = plans.find((p) => p.decision === 'sequential');
    const parPlan = plans.find((p) => p.decision === 'parallel');
    expect(seqPlan).toBeDefined();
    expect(parPlan).toBeDefined();
    expect(seqPlan?.tickets).toContain('A');
    expect(seqPlan?.tickets).toContain('B');
    expect(parPlan?.tickets).toContain('C');
  });
});
