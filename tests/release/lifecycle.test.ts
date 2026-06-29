import { ReleaseLifecycle, defaultReleaseConfig } from '../../src/release/lifecycle';
import { GitOps, Commit, MergeOpts, PushOpts } from '../../src/release/types';

function makeMockGit(overrides: Partial<GitOps> = {}): GitOps {
  const state: {
    branches: string[];
    tags: string[];
    currentBranch: string;
    files: Record<string, string>;
    commits: string[];
    tagMap: Set<string>;
  } = {
    branches: ['main', 'develop'],
    tags: [],
    currentBranch: 'main',
    files: {
      'package.json': JSON.stringify({ name: 'test', version: '0.0.0' }),
    },
    commits: [],
    tagMap: new Set(),
  };

  const git: GitOps = {
    currentBranch: async () => state.currentBranch,
    tags: async () => [...state.tags],
    branches: async () => [...state.branches],
    latestTag: async () => state.tags[state.tags.length - 1] ?? null,
    createBranch: async (name: string, _from: string) => {
      if (!state.branches.includes(name)) state.branches.push(name);
    },
    deleteBranch: async (name: string) => {
      state.branches = state.branches.filter((b) => b !== name);
    },
    checkout: async (branch: string) => {
      state.currentBranch = branch;
    },
    merge: async (_branch: string, _opts?: MergeOpts) => {},
    tag: async (name: string, _message?: string) => {
      state.tags.push(name);
      state.tagMap.add(name);
    },
    push: async (_branch: string, _opts?: PushOpts) => {},
    pushTag: async (tag: string) => {
      state.tagMap.add(tag);
    },
    log: async (_from: string, _to?: string): Promise<Commit[]> => [],
    hasUncommittedChanges: async () => false,
    readFile: async (path: string) => state.files[path] ?? null,
    writeFile: async (path: string, content: string) => {
      state.files[path] = content;
    },
    commit: async (message: string) => {
      state.commits.push(message);
    },
    tagExists: async (tag: string) => state.tagMap.has(tag),
    branchExists: async (name: string) => state.branches.includes(name),
    ...overrides,
  };

  return git;
}

function makeLifecycle(gitOverrides: Partial<GitOps> = {}): ReleaseLifecycle {
  const cfg = defaultReleaseConfig();
  const git = makeMockGit(gitOverrides);
  return new ReleaseLifecycle({ config: cfg, git });
}

describe('ReleaseLifecycle.createRelease', () => {
  it('creates a new release branch from main', async () => {
    const git = makeMockGit();
    const lc = new ReleaseLifecycle({ config: defaultReleaseConfig(), git });

    const result = await lc.createRelease('minor');
    expect(result.isNew).toBe(true);
    expect(result.version).toBe('0.1.0');
    expect(result.branch).toBe('release/0.1');
    expect(result.tag).toBe('v0.1.0');
  });

  it('returns isNew=false if branch already exists', async () => {
    const git = makeMockGit();
    const lc = new ReleaseLifecycle({ config: defaultReleaseConfig(), git });

    await lc.createRelease('minor');
    const second = await lc.createRelease('minor');
    expect(second.isNew).toBe(false);
  });

  it('bumps from existing tags', async () => {
    const git = makeMockGit({ tags: async () => ['v1.0.0', 'v1.1.0'] });
    const lc = new ReleaseLifecycle({ config: defaultReleaseConfig(), git });

    const result = await lc.createRelease('minor');
    expect(result.version).toBe('1.2.0');
    expect(result.branch).toBe('release/1.2');
  });

  it('writes updated package.json', async () => {
    const git = makeMockGit();
    const lc = new ReleaseLifecycle({ config: defaultReleaseConfig(), git });

    await lc.createRelease('patch');
    const content = await git.readFile('package.json');
    const pkg = JSON.parse(content!);
    expect(pkg.version).toBe('0.0.1');
  });
});

describe('ReleaseLifecycle.hotfixStart', () => {
  it('creates a hotfix branch with bumped patch', async () => {
    const git = makeMockGit({ tags: async () => ['v1.2.0'] });
    const lc = new ReleaseLifecycle({ config: defaultReleaseConfig(), git });

    const result = await lc.hotfixStart();
    expect(result.version).toBe('1.2.1');
    expect(result.branch).toBe('hotfix/1.2.1');
    expect(result.basedOn).toBe('main');
  });

  it('starts from 0.0.0 when no tags exist', async () => {
    const lc = makeLifecycle();
    const result = await lc.hotfixStart();
    expect(result.version).toBe('0.0.1');
    expect(result.branch).toBe('hotfix/0.0.1');
  });
});

describe('ReleaseLifecycle.hotfixFinish', () => {
  it('merges hotfix into main, develop, and release branches', async () => {
    const merged: string[] = [];
    const git = makeMockGit({
      branches: async () => ['main', 'develop', 'release/1.2'],
      merge: async (branch: string) => {
        merged.push(branch);
      },
    });
    const lc = new ReleaseLifecycle({ config: defaultReleaseConfig(), git });

    await lc.hotfixFinish('hotfix/1.2.1');

    expect(merged).toContain('hotfix/1.2.1');
    expect(merged.length).toBe(3);
  });

  it('skips develop if branch does not exist', async () => {
    const merged: string[] = [];
    const git = makeMockGit({
      branches: async () => ['main', 'release/1.2'],
      merge: async (branch: string) => {
        merged.push(branch);
      },
    });
    const lc = new ReleaseLifecycle({ config: defaultReleaseConfig(), git });

    await lc.hotfixFinish('hotfix/1.2.1');
    expect(merged.length).toBe(2);
  });
});

describe('ReleaseLifecycle.tagMain', () => {
  it('skips if no existing tags', async () => {
    await expect(makeLifecycle().tagMain()).rejects.toThrow('No existing tags');
  });

  it('skips if tag already exists and no new commits', async () => {
    const git = makeMockGit({
      tags: async () => ['v1.0.0'],
      tagExists: async () => true,
    });
    const lc = new ReleaseLifecycle({ config: defaultReleaseConfig(), git });
    const result = await lc.tagMain();
    expect(result.skipped).toBe(true);
  });

  it('creates tag when post-release commits exist', async () => {
    const newTag: string[] = [];
    const git = makeMockGit({
      tags: async () => ['v1.0.0'],
      tagExists: async (t) => newTag.includes(t),
      log: async (): Promise<Commit[]> => [
        { hash: 'abc', subject: 'fix: something', author: 'dev', date: new Date() },
      ],
      tag: async (name: string) => {
        newTag.push(name);
      },
      pushTag: async () => {},
    });
    const lc = new ReleaseLifecycle({ config: defaultReleaseConfig(), git });
    const result = await lc.tagMain();
    expect(result.skipped).toBe(false);
    expect(result.tag).toBe('v1.0.0');
  });
});

describe('ReleaseLifecycle.featureBranchName', () => {
  it('creates conventional-commit style branch name', () => {
    const lc = makeLifecycle();
    const name = lc.featureBranchName({
      type: 'feat',
      ticketId: 'ENG-123',
      description: 'Add user authentication',
    });
    expect(name).toBe('feat/ENG-123-add-user-authentication');
  });

  it('slugifies description', () => {
    const lc = makeLifecycle();
    const name = lc.featureBranchName({
      type: 'fix',
      ticketId: 'ENG-99',
      description: 'Fix the auth!! Bug (special chars)',
    });
    expect(name).toBe('fix/ENG-99-fix-the-auth-bug-special-chars');
  });

  it('truncates long descriptions to 50 chars', () => {
    const lc = makeLifecycle();
    const name = lc.featureBranchName({
      type: 'refactor',
      ticketId: 'ENG-1',
      description: 'a'.repeat(100),
    });
    // ENG-1-<desc>: split on '-' → ['ENG','1','aaa...'], skip 2 ticket parts
    const slug = name.split('/')[1].split('-').slice(2).join('-');
    expect(slug.length).toBeLessThanOrEqual(50);
  });
});

describe('ReleaseLifecycle.createFeatureBranch', () => {
  it('creates branch and returns name', async () => {
    const git = makeMockGit();
    const lc = new ReleaseLifecycle({ config: defaultReleaseConfig(), git });

    const name = await lc.createFeatureBranch({
      type: 'feat',
      ticketId: 'ENG-42',
      description: 'new feature',
    });
    expect(name).toBe('feat/ENG-42-new-feature');
    const branches = await git.branches();
    expect(branches).toContain('feat/ENG-42-new-feature');
  });

  it('does not duplicate branch if already exists', async () => {
    const git = makeMockGit({ branches: async () => ['main', 'feat/ENG-42-new-feature'] });
    const lc = new ReleaseLifecycle({ config: defaultReleaseConfig(), git });

    const name = await lc.createFeatureBranch({
      type: 'feat',
      ticketId: 'ENG-42',
      description: 'new feature',
    });
    expect(name).toBe('feat/ENG-42-new-feature');
  });
});
