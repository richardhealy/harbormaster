import { featureBranchName } from '../src/release/lifecycle';

describe('featureBranchName', () => {
  it('creates a conventional branch name', () => {
    const name = featureBranchName('feat', 'ENG-123', 'Add new scheduler');
    expect(name).toBe('feat/ENG-123-add-new-scheduler');
  });

  it('truncates long descriptions', () => {
    const name = featureBranchName('fix', 'ENG-456', 'A'.repeat(100));
    expect(name.length).toBeLessThanOrEqual('fix/ENG-456-'.length + 40);
  });

  it('replaces non-alphanumeric chars with hyphens', () => {
    const name = featureBranchName('chore', 'ENG-789', 'Update deps & config!');
    expect(name).toBe('chore/ENG-789-update-deps-config-');
  });

  it('falls back to feat for unknown type', () => {
    const name = featureBranchName('unknown', 'ENG-001', 'something');
    expect(name.startsWith('feat/')).toBe(true);
  });

  it('accepts all known conventional commit types', () => {
    const types = ['feat', 'fix', 'chore', 'refactor', 'test', 'docs', 'perf', 'ci'];
    for (const type of types) {
      const name = featureBranchName(type, 'T-1', 'desc');
      expect(name.startsWith(`${type}/`)).toBe(true);
    }
  });
});
