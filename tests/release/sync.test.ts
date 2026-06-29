import { SyncManager } from '../../src/release/sync';

describe('SyncManager.featureBranchName', () => {
  test('builds conventional-commit feature branch name', () => {
    const name = SyncManager.featureBranchName('feat', 'HM-42', 'add-scheduler');
    expect(name).toBe('feat/HM-42-add-scheduler');
  });

  test('works with fix type', () => {
    const name = SyncManager.featureBranchName('fix', 'HM-7', 'auth-token-refresh');
    expect(name).toBe('fix/HM-7-auth-token-refresh');
  });
});
