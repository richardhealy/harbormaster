import { describe, it, expect } from 'vitest';
import {
  POLICIES,
  stagesForPolicy,
  createGateResult,
  isGreenForMerge,
  GatePipeline,
} from '../gates';

describe('POLICIES', () => {
  it('low risk auto-merges on green CI without HITL', () => {
    expect(POLICIES.low.autoMergeOnGreenCI).toBe(true);
    expect(POLICIES.low.requireHITL).toBe(false);
  });

  it('high risk requires HITL and QA', () => {
    expect(POLICIES.high.requireHITL).toBe(true);
    expect(POLICIES.high.requireQA).toBe(true);
  });
});

describe('stagesForPolicy', () => {
  it('low risk requires scope + ci only', () => {
    const stages = stagesForPolicy(POLICIES.low);
    expect(stages).toContain('scope');
    expect(stages).toContain('ci');
    expect(stages).not.toContain('hitl');
    expect(stages).not.toContain('qa');
  });

  it('high risk requires all stages', () => {
    const stages = stagesForPolicy(POLICIES.high);
    expect(stages).toContain('scope');
    expect(stages).toContain('ci');
    expect(stages).toContain('qa');
    expect(stages).toContain('hitl');
  });
});

describe('isGreenForMerge', () => {
  it('returns true when all required stages pass for low-risk ticket', () => {
    const pipeline: GatePipeline = {
      ticketId: 'T1',
      riskLevel: 'low',
      results: [
        createGateResult('scope', 'passed'),
        createGateResult('ci', 'passed'),
      ],
    };
    expect(isGreenForMerge(pipeline)).toBe(true);
  });

  it('returns false when a required stage is missing', () => {
    const pipeline: GatePipeline = {
      ticketId: 'T2',
      riskLevel: 'low',
      results: [createGateResult('scope', 'passed')],
    };
    expect(isGreenForMerge(pipeline)).toBe(false);
  });

  it('returns false when a required stage failed', () => {
    const pipeline: GatePipeline = {
      ticketId: 'T3',
      riskLevel: 'low',
      results: [
        createGateResult('scope', 'passed'),
        createGateResult('ci', 'failed'),
      ],
    };
    expect(isGreenForMerge(pipeline)).toBe(false);
  });

  it('requires HITL pass for high-risk ticket', () => {
    const withoutHITL: GatePipeline = {
      ticketId: 'T4',
      riskLevel: 'high',
      results: [
        createGateResult('scope', 'passed'),
        createGateResult('ci', 'passed'),
        createGateResult('qa', 'passed'),
      ],
    };
    expect(isGreenForMerge(withoutHITL)).toBe(false);

    const withHITL: GatePipeline = {
      ...withoutHITL,
      results: [...withoutHITL.results, createGateResult('hitl', 'passed', { reviewerId: 'human-1' })],
    };
    expect(isGreenForMerge(withHITL)).toBe(true);
  });
});
