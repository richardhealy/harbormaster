import path from 'path';
import os from 'os';
import fs from 'fs';
import { simpleGit } from 'simple-git';
import { HotfixManager } from '../../src/release/hotfix';

async function makeTmpRepo(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-test-'));
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'test@example.com');
  await git.addConfig('user.name', 'Test');
  fs.writeFileSync(path.join(dir, 'README.md'), '# test');
  await git.add('.');
  await git.commit('init');
  try { await git.branch(['-M', 'main']); } catch { /* already main */ }
  return dir;
}

describe('HotfixManager', () => {
  let repoPath: string;
  let manager: HotfixManager;

  beforeEach(async () => {
    repoPath = await makeTmpRepo();
    manager = new HotfixManager(repoPath);
  });

  afterEach(() => {
    fs.rmSync(repoPath, { recursive: true, force: true });
  });

  test('start creates hotfix/<name> branch', async () => {
    const branch = await manager.start('fix-auth');
    expect(branch).toBe('hotfix/fix-auth');
    const git = simpleGit(repoPath);
    const branches = await git.branchLocal();
    expect(branches.branches['hotfix/fix-auth']).toBeDefined();
  });

  test('start throws if hotfix branch already exists', async () => {
    await manager.start('fix-auth');
    await expect(manager.start('fix-auth')).rejects.toThrow('already exists');
  });

  test('finish merges hotfix into all target branches', async () => {
    const git = simpleGit(repoPath);
    // Set up develop and release/1.0 branches
    await git.checkoutBranch('develop', 'main');
    await git.checkout('main');
    await git.checkoutBranch('release/1.0', 'main');
    await git.checkout('main');

    const hotfixBranch = await manager.start('critical-bug');
    fs.writeFileSync(path.join(repoPath, 'fix.txt'), 'fix');
    await git.add('.');
    await git.commit('fix: critical bug');

    const results = await manager.finish(hotfixBranch, ['main', 'develop', 'release/1.0']);
    expect(results.every((r) => r.merged)).toBe(true);
  });

  test('activeReleaseBranches returns only release/* branches', async () => {
    const git = simpleGit(repoPath);
    await git.checkoutBranch('release/1.0', 'main');
    await git.checkout('main');
    await git.checkoutBranch('release/1.1', 'main');
    await git.checkout('main');

    const branches = await manager.activeReleaseBranches();
    expect(branches).toContain('release/1.0');
    expect(branches).toContain('release/1.1');
  });
});
