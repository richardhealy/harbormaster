import { describe, it, expect } from 'vitest'
import { Scheduler } from '../../src/scheduler/planner'
import type { TicketWithImpact } from '../../src/scheduler/types'
import type { ImpactSurface } from '../../src/impact/types'

// ─── helpers ─────────────────────────────────────────────────────────────────

function ticket(
  ticketId: string,
  files: string[],
): TicketWithImpact {
  const impact: ImpactSurface = {
    ticketId,
    directFiles: files,
    transitiveFiles: files,
  }
  return { ticketId, impact }
}

function ticketWith(
  ticketId: string,
  directFiles: string[],
  transitiveFiles: string[],
): TicketWithImpact {
  const impact: ImpactSurface = { ticketId, directFiles, transitiveFiles }
  return { ticketId, impact }
}

function allTickets(plan: ReturnType<Scheduler['plan']>): string[] {
  return plan.stages.flatMap(s => s.groups.flatMap(g => g.tickets))
}

// ─── edge cases ───────────────────────────────────────────────────────────────

describe('Scheduler — edge cases', () => {
  it('returns empty plan for no tickets', () => {
    const plan = new Scheduler().plan([])
    expect(plan.stages).toHaveLength(0)
    expect(plan.overlaps).toHaveLength(0)
  })

  it('returns single stage with single group for one ticket', () => {
    const plan = new Scheduler().plan([ticket('T1', ['a.ts'])])
    expect(plan.stages).toHaveLength(1)
    expect(plan.stages[0].groups).toHaveLength(1)
    expect(plan.stages[0].groups[0].tickets).toEqual(['T1'])
    expect(plan.stages[0].groups[0].decision).toBe('parallel')
  })

  it('includes all input tickets in the plan', () => {
    const tickets = ['T1', 'T2', 'T3', 'T4'].map(id => ticket(id, [`${id}.ts`]))
    const plan = new Scheduler().plan(tickets)
    expect(allTickets(plan).sort()).toEqual(['T1', 'T2', 'T3', 'T4'])
  })
})

// ─── parallel scheduling (no overlap) ────────────────────────────────────────

describe('Scheduler — parallel (no overlap)', () => {
  it('places non-overlapping tickets in the same stage', () => {
    const t1 = ticket('T1', ['auth.ts'])
    const t2 = ticket('T2', ['ui.ts'])
    const plan = new Scheduler().plan([t1, t2])
    expect(plan.stages).toHaveLength(1)
    const allIds = plan.stages[0].groups.flatMap(g => g.tickets).sort()
    expect(allIds).toEqual(['T1', 'T2'])
  })

  it('all groups in stage 0 have decision parallel when no overlap', () => {
    const tickets = [
      ticket('T1', ['db.ts']),
      ticket('T2', ['api.ts']),
      ticket('T3', ['ui.ts']),
    ]
    const plan = new Scheduler().plan(tickets)
    for (const group of plan.stages[0].groups) {
      expect(group.decision).toBe('parallel')
    }
  })

  it('records zero-ratio overlaps in the overlaps array', () => {
    const plan = new Scheduler().plan([ticket('T1', ['a.ts']), ticket('T2', ['b.ts'])])
    expect(plan.overlaps).toHaveLength(1)
    expect(plan.overlaps[0].overlapRatio).toBe(0)
  })
})

// ─── headline test: sequencing overlapping tickets ────────────────────────────

describe('Scheduler — sequence (overlap below merge threshold)', () => {
  it('HEADLINE: tickets with overlapping impact are NOT in the same stage', () => {
    // T1 and T2 both touch shared.ts → must be sequenced
    const t1 = ticket('T1', ['shared.ts', 'auth.ts'])
    const t2 = ticket('T2', ['shared.ts', 'payment.ts'])
    const plan = new Scheduler().plan([t1, t2])

    // They must be in different stages
    const stageForT1 = plan.stages.find(s => s.groups.some(g => g.tickets.includes('T1')))!
    const stageForT2 = plan.stages.find(s => s.groups.some(g => g.tickets.includes('T2')))!
    expect(stageForT1.index).not.toBe(stageForT2.index)
  })

  it('puts the earlier-input-order ticket in stage 0', () => {
    // Partial overlap (0.5): below mergeThreshold=0.7 → sequence, not merge
    const t1 = ticket('T1', ['shared.ts', 'auth.ts'])
    const t2 = ticket('T2', ['shared.ts', 'payment.ts'])
    const plan = new Scheduler().plan([t1, t2])

    const stage0tickets = plan.stages[0].groups.flatMap(g => g.tickets)
    expect(stage0tickets).toContain('T1')
    expect(stage0tickets).not.toContain('T2')
  })

  it('uses two stages for two conflicting tickets', () => {
    // Partial overlap (0.5): below mergeThreshold=0.7 → two separate stages
    const t1 = ticket('T1', ['shared.ts', 'auth.ts'])
    const t2 = ticket('T2', ['shared.ts', 'billing.ts'])
    const plan = new Scheduler().plan([t1, t2])
    expect(plan.stages).toHaveLength(2)
  })

  it('uses three stages for a linear chain of conflicts', () => {
    // T1→T2→T3 each share one file with the next
    const t1 = ticket('T1', ['a.ts'])
    const t2 = ticket('T2', ['a.ts', 'b.ts'])
    const t3 = ticket('T3', ['b.ts', 'c.ts'])
    const plan = new Scheduler().plan([t1, t2, t3])
    // T1 conflicts with T2 (shares a.ts), T2 conflicts with T3 (shares b.ts)
    expect(plan.stages.length).toBeGreaterThanOrEqual(2)
  })

  it('non-conflicting tickets in later stages can run alongside each other', () => {
    // T1 and T2: no overlap → parallel (stage 0)
    // T3 conflicts with T1 (50% overlap, below merge threshold) → stage 1
    // T2 has no conflict with T3 → T2 stays in stage 0 alongside T1
    const t1 = ticket('T1', ['shared.ts', 'x.ts'])
    const t2 = ticket('T2', ['unrelated.ts'])
    const t3 = ticket('T3', ['shared.ts', 'extra.ts'])
    const plan = new Scheduler().plan([t1, t2, t3])
    // T1 and T2 should be in stage 0, T3 in stage 1
    const stage0 = plan.stages[0].groups.flatMap(g => g.tickets)
    expect(stage0).toContain('T1')
    expect(stage0).toContain('T2')
    const stage1 = plan.stages[1].groups.flatMap(g => g.tickets)
    expect(stage1).toContain('T3')
  })
})

// ─── merge scheduling (high overlap) ─────────────────────────────────────────

describe('Scheduler — merge (high overlap)', () => {
  it('merges tickets when overlap ratio exceeds the merge threshold', () => {
    // T1 touches files a,b,c,d; T2 touches a,b,c → ratio 3/3 = 1.0 > 0.7
    const t1 = ticketWith('T1', ['a.ts', 'b.ts', 'c.ts', 'd.ts'], ['a.ts', 'b.ts', 'c.ts', 'd.ts'])
    const t2 = ticketWith('T2', ['a.ts', 'b.ts', 'c.ts'], ['a.ts', 'b.ts', 'c.ts'])
    const plan = new Scheduler().plan([t1, t2])

    const mergeGroup = plan.stages
      .flatMap(s => s.groups)
      .find(g => g.decision === 'merge')
    expect(mergeGroup).toBeDefined()
    expect(mergeGroup!.tickets).toContain('T1')
    expect(mergeGroup!.tickets).toContain('T2')
  })

  it('merged tickets appear in the same stage', () => {
    const t1 = ticket('T1', ['a.ts', 'b.ts', 'c.ts'])
    const t2 = ticket('T2', ['a.ts', 'b.ts', 'c.ts'])
    const plan = new Scheduler().plan([t1, t2])
    const stage = plan.stages.find(s =>
      s.groups.some(g => g.decision === 'merge' && g.tickets.includes('T1')),
    )!
    const mergeGroup = stage.groups.find(g => g.decision === 'merge')!
    expect(mergeGroup.tickets).toContain('T2')
  })

  it('does not merge tickets below the merge threshold', () => {
    // Partial overlap: T1 has 4 files, T2 has 4 files, share 2 → ratio 2/4 = 0.5 < 0.7
    const t1 = ticket('T1', ['a.ts', 'b.ts', 'c.ts', 'd.ts'])
    const t2 = ticket('T2', ['a.ts', 'b.ts', 'e.ts', 'f.ts'])
    const plan = new Scheduler().plan([t1, t2])
    const mergeGroups = plan.stages.flatMap(s => s.groups).filter(g => g.decision === 'merge')
    expect(mergeGroups).toHaveLength(0)
  })

  it('respects a custom merge threshold', () => {
    // 50% overlap: with threshold 0.4, should merge; with threshold 0.6, should not
    const t1 = ticket('T1', ['a.ts', 'b.ts'])
    const t2 = ticket('T2', ['a.ts', 'c.ts'])
    // ratio = 1/2 = 0.5
    const planMerge = new Scheduler({ mergeThreshold: 0.4 }).plan([t1, t2])
    const planSeq = new Scheduler({ mergeThreshold: 0.6 }).plan([t1, t2])

    const mergeGroups = planMerge.stages.flatMap(s => s.groups).filter(g => g.decision === 'merge')
    expect(mergeGroups).toHaveLength(1)

    const seqMergeGroups = planSeq.stages.flatMap(s => s.groups).filter(g => g.decision === 'merge')
    expect(seqMergeGroups).toHaveLength(0)
  })

  it('assigns reason text to merged groups', () => {
    const t1 = ticket('T1', ['a.ts', 'b.ts', 'c.ts'])
    const t2 = ticket('T2', ['a.ts', 'b.ts', 'c.ts'])
    const plan = new Scheduler().plan([t1, t2])
    const mergeGroup = plan.stages.flatMap(s => s.groups).find(g => g.decision === 'merge')!
    expect(mergeGroup.reason).toBeTruthy()
    expect(mergeGroup.reason.length).toBeGreaterThan(10)
  })
})

// ─── overlaps output ──────────────────────────────────────────────────────────

describe('Scheduler — overlaps array', () => {
  it('includes one overlap entry per pair', () => {
    const tickets = ['T1', 'T2', 'T3'].map(id => ticket(id, [`${id}.ts`]))
    const plan = new Scheduler().plan(tickets)
    // 3 choose 2 = 3 pairs
    expect(plan.overlaps).toHaveLength(3)
  })

  it('correctly identifies overlapping pairs', () => {
    const t1 = ticket('T1', ['shared.ts'])
    const t2 = ticket('T2', ['shared.ts'])
    const t3 = ticket('T3', ['other.ts'])
    const plan = new Scheduler().plan([t1, t2, t3])
    const pair12 = plan.overlaps.find(
      o =>
        (o.ticketA === 'T1' && o.ticketB === 'T2') ||
        (o.ticketA === 'T2' && o.ticketB === 'T1'),
    )!
    expect(pair12.overlapRatio).toBeGreaterThan(0)

    const pair13 = plan.overlaps.find(
      o =>
        (o.ticketA === 'T1' && o.ticketB === 'T3') ||
        (o.ticketA === 'T3' && o.ticketB === 'T1'),
    )!
    expect(pair13.overlapRatio).toBe(0)
  })
})

// ─── stage ordering and index ─────────────────────────────────────────────────

describe('Scheduler — stage structure', () => {
  it('stages are indexed starting at 0', () => {
    const t1 = ticket('T1', ['a.ts'])
    const t2 = ticket('T2', ['a.ts'])
    const plan = new Scheduler().plan([t1, t2])
    for (let i = 0; i < plan.stages.length; i++) {
      expect(plan.stages[i].index).toBe(i)
    }
  })

  it('every ticket appears exactly once across all stages', () => {
    const tickets = ['T1', 'T2', 'T3', 'T4', 'T5'].map(id => ticket(id, [`f${id}.ts`]))
    const plan = new Scheduler().plan(tickets)
    const seen = allTickets(plan)
    const unique = new Set(seen)
    expect(unique.size).toBe(seen.length)
    expect(unique.size).toBe(5)
  })
})
