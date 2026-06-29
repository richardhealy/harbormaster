import { shouldRerun, createRerunRecord, RerunContext } from '../src/integration/rerun';

function makeCtx(overrides: Partial<RerunContext> = {}): RerunContext {
  return {
    ticketId: 'ENG-123',
    originalBranch: 'feat/ENG-123-my-feature',
    failureReason: 'rebase_conflict',
    newTip: 'abc1234',
    agentId: 'agent-1',
    attempt: 0,
    ...overrides,
  };
}

describe('shouldRerun', () => {
  it('reruns on rebase conflict', () => {
    const decision = shouldRerun(makeCtx({ failureReason: 'rebase_conflict' }));
    expect(decision.shouldRerun).toBe(true);
    expect(decision.newBranch).toContain('retry');
  });

  it('reruns on CI failure', () => {
    const decision = shouldRerun(makeCtx({ failureReason: 'ci_failure' }));
    expect(decision.shouldRerun).toBe(true);
  });

  it('does not rerun on semantic conflict', () => {
    const decision = shouldRerun(makeCtx({ failureReason: 'semantic_conflict' }));
    expect(decision.shouldRerun).toBe(false);
    expect(decision.reason).toContain('human review');
  });

  it('stops after max attempts', () => {
    const decision = shouldRerun(makeCtx({ attempt: 3 }));
    expect(decision.shouldRerun).toBe(false);
    expect(decision.reason).toContain('maximum');
  });

  it('increments attempt number in branch name', () => {
    const decision = shouldRerun(makeCtx({ attempt: 1 }));
    expect(decision.newBranch).toContain('retry2');
  });
});

describe('createRerunRecord', () => {
  it('creates a record with incremented attempt', () => {
    const ctx = makeCtx({ attempt: 1 });
    const record = createRerunRecord(ctx, 'feat/ENG-123-my-feature-retry2');
    expect(record.attempt).toBe(2);
    expect(record.ticketId).toBe('ENG-123');
    expect(record.newBranch).toBe('feat/ENG-123-my-feature-retry2');
    expect(record.redispatchedAt).toBeInstanceOf(Date);
  });
});
