import {
  evaluateScopeGate,
  evaluateCIGate,
  getPolicyForDomain,
  requireHITLApproval,
  recordHITLApproval,
  runGatePipeline,
  GateResult,
} from '../src/gates';

describe('evaluateScopeGate', () => {
  it('passes when no scope constraint', () => {
    const result = evaluateScopeGate([], ['any.ts']);
    expect(result.status).toBe('passed');
  });

  it('passes when all files are within scope', () => {
    const result = evaluateScopeGate(['src/a.ts', 'src/b.ts'], ['src/a.ts', 'src/b.ts']);
    expect(result.status).toBe('passed');
  });

  it('fails when too many files are outside scope', () => {
    const expected = ['src/a.ts'];
    const actual = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts'];
    const result = evaluateScopeGate(expected, actual, 0.3);
    expect(result.status).toBe('failed');
    expect(result.reason).toContain('outside expected scope');
  });

  it('passes when drift is below threshold', () => {
    const expected = ['src/a.ts', 'src/b.ts', 'src/c.ts'];
    const actual = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'];
    const result = evaluateScopeGate(expected, actual, 0.5);
    expect(result.status).toBe('passed');
  });
});

describe('evaluateCIGate', () => {
  it('passes when CI passed', () => {
    const result = evaluateCIGate(true);
    expect(result.status).toBe('passed');
  });

  it('fails when CI failed', () => {
    const result = evaluateCIGate(false, 'Tests failed');
    expect(result.status).toBe('failed');
    expect(result.reason).toBe('Tests failed');
  });
});

describe('getPolicyForDomain', () => {
  it('returns low-risk policy for docs', () => {
    const policy = getPolicyForDomain('docs');
    expect(policy.risk).toBe('low');
    expect(policy.autoMergeOnGreen).toBe(true);
    expect(policy.hitlRequired).toBe(false);
  });

  it('returns high-risk policy for migration', () => {
    const policy = getPolicyForDomain('migration');
    expect(policy.risk).toBe('high');
    expect(policy.hitlRequired).toBe(true);
    expect(policy.requiredGates).toContain('hitl');
  });

  it('falls back to feature policy for unknown domain', () => {
    const policy = getPolicyForDomain('unknown-domain');
    expect(policy.domain).toBe('feature');
  });

  it('allows custom policies to override defaults', () => {
    const custom: import('../src/gates').GatePolicy[] = [{
      domain: 'custom',
      risk: 'high',
      requiredGates: ['scope', 'ci', 'hitl'],
      autoMergeOnGreen: false,
      hitlRequired: true,
    }];
    const policy = getPolicyForDomain('custom', [...custom]);
    expect(policy.domain).toBe('custom');
    expect(policy.risk).toBe('high');
  });
});

describe('requireHITLApproval', () => {
  it('returns waiting_approval status', () => {
    const result = requireHITLApproval('ENG-123');
    expect(result.status).toBe('waiting_approval');
    expect(result.gate).toBe('hitl');
  });
});

describe('recordHITLApproval', () => {
  it('returns passed status with approver info', () => {
    const result = recordHITLApproval('alice');
    expect(result.status).toBe('passed');
    expect(result.approvedBy).toBe('alice');
    expect(result.approvedAt).toBeInstanceOf(Date);
  });
});

describe('runGatePipeline', () => {
  const featurePolicy = getPolicyForDomain('feature');

  it('returns passed when all gates pass', () => {
    const results: GateResult[] = [
      { gate: 'scope', status: 'passed' },
      { gate: 'ci', status: 'passed' },
      { gate: 'qa', status: 'passed' },
    ];
    const pipeline = runGatePipeline('ENG-1', featurePolicy, results);
    expect(pipeline.overallStatus).toBe('passed');
  });

  it('returns failed when any gate fails', () => {
    const results: GateResult[] = [
      { gate: 'scope', status: 'passed' },
      { gate: 'ci', status: 'failed' },
      { gate: 'qa', status: 'passed' },
    ];
    const pipeline = runGatePipeline('ENG-1', featurePolicy, results);
    expect(pipeline.overallStatus).toBe('failed');
  });

  it('returns waiting_approval when hitl is pending', () => {
    const migrationPolicy = getPolicyForDomain('migration');
    const results: GateResult[] = [
      { gate: 'scope', status: 'passed' },
      { gate: 'ci', status: 'passed' },
      { gate: 'qa', status: 'passed' },
      { gate: 'hitl', status: 'waiting_approval' },
    ];
    const pipeline = runGatePipeline('ENG-1', migrationPolicy, results);
    expect(pipeline.overallStatus).toBe('waiting_approval');
  });

  it('fills missing gates as pending', () => {
    const pipeline = runGatePipeline('ENG-1', featurePolicy, []);
    expect(pipeline.results.every((r) => r.status === 'pending')).toBe(true);
    expect(pipeline.overallStatus).toBe('pending');
  });
});
