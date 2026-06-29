export interface RerunContext {
  ticketId: string;
  originalBranch: string;
  failureReason: 'rebase_conflict' | 'ci_failure' | 'semantic_conflict';
  newTip: string;
  agentId: string;
  attempt: number;
}

export interface RerunDecision {
  shouldRerun: boolean;
  reason: string;
  newBranch?: string;
}

const MAX_ATTEMPTS = 3;

export function shouldRerun(ctx: RerunContext): RerunDecision {
  if (ctx.attempt >= MAX_ATTEMPTS) {
    return {
      shouldRerun: false,
      reason: `Exceeded maximum re-run attempts (${MAX_ATTEMPTS}) for ticket ${ctx.ticketId}`,
    };
  }

  switch (ctx.failureReason) {
    case 'rebase_conflict':
      return {
        shouldRerun: true,
        reason: `Rebase conflict on ${ctx.originalBranch} — re-dispatching against new tip ${ctx.newTip}`,
        newBranch: `${ctx.originalBranch}-retry${ctx.attempt + 1}`,
      };

    case 'ci_failure':
      return {
        shouldRerun: true,
        reason: `CI failure — re-running against new tip ${ctx.newTip} in case failure was caused by stale base`,
        newBranch: `${ctx.originalBranch}-retry${ctx.attempt + 1}`,
      };

    case 'semantic_conflict':
      return {
        shouldRerun: false,
        reason: `Semantic conflict detected — requires human review before re-run on ticket ${ctx.ticketId}`,
      };

    default:
      return { shouldRerun: false, reason: 'Unknown failure reason' };
  }
}

export interface RerunRecord {
  ticketId: string;
  originalBranch: string;
  newBranch: string;
  attempt: number;
  redispatchedAt: Date;
}

export function createRerunRecord(ctx: RerunContext, newBranch: string): RerunRecord {
  return {
    ticketId: ctx.ticketId,
    originalBranch: ctx.originalBranch,
    newBranch,
    attempt: ctx.attempt + 1,
    redispatchedAt: new Date(),
  };
}
