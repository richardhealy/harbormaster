import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import simpleGit, { SimpleGit } from 'simple-git';
import {
  tagMain,
  hasPostReleaseRun,
  listReleaseTags,
  latestReleaseTag,
  TagOptions,
} from '../../src/release/tags';

async function makeRepo(): Promise<{ dir: string; git: SimpleGit }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-tags-test-'));
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.name', 'Test User');
  await git.addConfig('user.email', 'test@example.com');

  fs.writeFileSync(path.join(dir, 'README.md'), '# test');
  await git.add('.');
  await git.commit('chore: initial');

  const branches = await git.branch();
  if (branches.current !== 'main') {
    await git.branch(['-m', branches.current, 'main']);
  }

  return { dir, git };
}

function makeOpts(git: SimpleGit): TagOptions {
  return { git, mainBranch: 'main' };
}

describe('tagMain', () => {
  it('creates a tag on the current commit', async () => {
    const { git } = await makeRepo();
    const opts = makeOpts(git);

    const result = await tagMain(opts, '1.0.0');
    expect(result.tag).toBe('v1.0.0');
    expect(result.alreadyExisted).toBe(false);

    const tags = await git.tags();
    expect(tags.all).toContain('v1.0.0');
  });

  it('is idempotent when tag already exists at HEAD', async () => {
    const { git } = await makeRepo();
    const opts = makeOpts(git);

    await tagMain(opts, '1.0.0');
    const result = await tagMain(opts, '1.0.0');
    expect(result.alreadyExisted).toBe(true);
  });

  it('throws when tag exists at a different commit', async () => {
    const { dir, git } = await makeRepo();
    const opts = makeOpts(git);

    await tagMain(opts, '1.0.0');

    // Add another commit
    fs.writeFileSync(path.join(dir, 'extra.txt'), 'extra');
    await git.add('.');
    await git.commit('chore: extra commit');

    // Pull update: refresh local tip (no remote needed here)
    await expect(tagMain(opts, '1.0.0')).rejects.toThrow(/already exists at/);
  });
});

describe('hasPostReleaseRun', () => {
  it('returns false when no tag exists', async () => {
    const { git } = await makeRepo();
    const opts = makeOpts(git);
    expect(await hasPostReleaseRun(opts, '1.0.0')).toBe(false);
  });

  it('returns false when tag exists but no new commits', async () => {
    const { git } = await makeRepo();
    const opts = makeOpts(git);
    await tagMain(opts, '1.0.0');
    expect(await hasPostReleaseRun(opts, '1.0.0')).toBe(false);
  });

  it('returns true when commits exist after the tag', async () => {
    const { dir, git } = await makeRepo();
    const opts = makeOpts(git);
    await tagMain(opts, '1.0.0');

    fs.writeFileSync(path.join(dir, 'post.txt'), 'post');
    await git.add('.');
    await git.commit('chore: post release');

    expect(await hasPostReleaseRun(opts, '1.0.0')).toBe(true);
  });
});

describe('listReleaseTags', () => {
  it('returns only semver tags', async () => {
    const { git } = await makeRepo();
    const opts = makeOpts(git);

    await git.addAnnotatedTag('v1.0.0', 'Release 1.0.0');
    await git.addAnnotatedTag('v1.1.0', 'Release 1.1.0');
    await git.addAnnotatedTag('not-a-version', 'Not semver');

    const tags = await listReleaseTags(opts);
    expect(tags).toContain('v1.0.0');
    expect(tags).toContain('v1.1.0');
    expect(tags).not.toContain('not-a-version');
  });
});

describe('latestReleaseTag', () => {
  it('returns highest semver tag', async () => {
    const { git } = await makeRepo();
    const opts = makeOpts(git);

    await git.addAnnotatedTag('v1.0.0', 'Release 1.0.0');
    await git.addAnnotatedTag('v2.0.0', 'Release 2.0.0');
    await git.addAnnotatedTag('v1.5.0', 'Release 1.5.0');

    const latest = await latestReleaseTag(opts);
    expect(latest).toBe('v2.0.0');
  });

  it('returns undefined when no release tags', async () => {
    const { git } = await makeRepo();
    const opts = makeOpts(git);
    expect(await latestReleaseTag(opts)).toBeUndefined();
  });
});
