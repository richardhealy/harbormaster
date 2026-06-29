import path from 'path';
import os from 'os';
import fs from 'fs';
import { simpleGit } from 'simple-git';
import { ReleaseBranchManager } from '../../src/release/branch';

async function makeTmpRepo(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-test-'));
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'test@example.com');
  await git.addConfig('user.name', 'Test');
  fs.writeFileSync(path.join(dir, 'README.md'), '# test');
  await git.add('.');
  await git.commit('init');
  // rename default branch to main
  try { await git.branch(['-M', 'main']); } catch { /* already main */ }
  return dir;
}

describe('ReleaseBranchManager', () => {
  let repoPath: string;
  let manager: ReleaseBranchManager;

  beforeEach(async () => {
    repoPath = await makeTmpRepo();
    manager = new ReleaseBranchManager(repoPath);
  });

  afterEach(() => {
    fs.rmSync(repoPath, { recursive: true, force: true });
  });

  test('createBranch creates release/<version> off main', async () => {
    const branch = await manager.createBranch('1.2.0');
    expect(branch).toBe('release/1.2.0');
    const git = simpleGit(repoPath);
    const branches = await git.branchLocal();
    expect(branches.branches['release/1.2.0']).toBeDefined();
  });

  test('createBranch throws if branch already exists', async () => {
    await manager.createBranch('1.2.0');
    await expect(manager.createBranch('1.2.0')).rejects.toThrow('already exists');
  });

  test('autoNextRelease creates branch for bumped version', async () => {
    const git = simpleGit(repoPath);
    await git.addAnnotatedTag('1.1.0', 'Release 1.1.0');

    const { version, branch } = await manager.autoNextRelease('minor');
    expect(version).toBe('1.2.0');
    expect(branch).toBe('release/1.2.0');
  });

  test('tagMain is idempotent — returns false on second call', async () => {
    const created = await manager.tagMain('1.0.0');
    expect(created).toBe(true);
    const second = await manager.tagMain('1.0.0');
    expect(second).toBe(false);
  });

  test('listReleaseBranches returns only release/* branches', async () => {
    await manager.createBranch('1.0.0');
    await manager.createBranch('1.1.0');
    const git = simpleGit(repoPath);
    await git.checkoutBranch('feature/other', 'main');

    const list = await manager.listReleaseBranches();
    expect(list).toContain('release/1.0.0');
    expect(list).toContain('release/1.1.0');
    expect(list).not.toContain('feature/other');
  });
});
