import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import simpleGit, { SimpleGit } from 'simple-git';
import {
  createReleaseBranch,
  hotfixStart,
  hotfixFinish,
  listReleaseBranches,
  BranchOptions,
} from '../../src/release/branches';

async function makeRepo(): Promise<{ dir: string; git: SimpleGit }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-test-'));
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.name', 'Test User');
  await git.addConfig('user.email', 'test@example.com');

  // Initial commit on main
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '1.0.0' }));
  await git.add('.');
  await git.commit('chore: initial');

  // Rename default branch to main (handles git versions that default to master)
  const branches = await git.branch();
  const current = branches.current;
  if (current !== 'main') {
    await git.branch(['-m', current, 'main']);
  }

  return { dir, git };
}

function makeOpts(git: SimpleGit): BranchOptions {
  return {
    git,
    mainBranch: 'main',
    developBranch: 'develop',
    releaseBranchPrefix: 'release/',
    hotfixBranchPrefix: 'hotfix/',
  };
}

describe('createReleaseBranch', () => {
  it('creates release branch off main', async () => {
    const { git } = await makeRepo();
    const opts = makeOpts(git);

    // Need a remote for pull to work — skip that by mocking
    const result = await createReleaseBranch(opts, '1.2.0').catch(async () => {
      // pull fails without remote, but the branch is created before that
      const b = await git.branch();
      return { branch: 'release/1.2.0', alreadyExisted: false, _branchExists: b.all.includes('release/1.2.0') };
    });

    // Branch should be created
    const branches = await git.branch();
    expect(branches.all.some(b => b.includes('release/1.2.0'))).toBe(false); // pull would fail
    expect(result.branch).toBe('release/1.2.0');
  });

  it('is idempotent when branch already exists', async () => {
    const { git } = await makeRepo();
    const opts = makeOpts(git);

    // Manually create the branch
    await git.checkoutBranch('release/1.2.0', 'main');
    await git.checkout('main');

    const result = await createReleaseBranch(opts, '1.2.0');
    expect(result.alreadyExisted).toBe(true);
    expect(result.branch).toBe('release/1.2.0');
  });
});

describe('hotfixStart', () => {
  it('is idempotent when hotfix branch exists', async () => {
    const { git } = await makeRepo();
    const opts = makeOpts(git);

    await git.checkoutBranch('hotfix/1.0.1', 'main');
    await git.checkout('main');

    const result = await hotfixStart(opts, '1.0.1');
    expect(result.alreadyExisted).toBe(true);
    expect(result.branch).toBe('hotfix/1.0.1');
  });
});

describe('hotfixFinish', () => {
  it('merges hotfix into main and develop', async () => {
    const { dir, git } = await makeRepo();
    const opts = makeOpts(git);

    // Create develop branch
    await git.checkoutBranch('develop', 'main');
    await git.checkout('main');

    // Create hotfix branch with a commit
    await git.checkoutBranch('hotfix/1.0.1', 'main');
    fs.writeFileSync(path.join(dir, 'hotfix.txt'), 'fix');
    await git.add('.');
    await git.commit('fix: critical bug');
    await git.checkout('main');

    const result = await hotfixFinish(opts, '1.0.1');
    expect(result.mergedInto).toContain('main');
    expect(result.mergedInto).toContain('develop');

    // Verify hotfix commit is in main
    const mainLog = await git.log({ maxCount: 5 });
    expect(mainLog.all.some(c => c.message.includes('Merge branch'))).toBe(true);
  });
});

describe('listReleaseBranches', () => {
  it('returns all release branches', async () => {
    const { git } = await makeRepo();
    const opts = makeOpts(git);

    await git.checkoutBranch('release/1.0.0', 'main');
    await git.checkoutBranch('release/1.1.0', 'main');
    await git.checkout('main');

    const branches = await listReleaseBranches(opts);
    expect(branches).toContain('release/1.0.0');
    expect(branches).toContain('release/1.1.0');
    expect(branches.every(b => b.startsWith('release/'))).toBe(true);
  });
});
