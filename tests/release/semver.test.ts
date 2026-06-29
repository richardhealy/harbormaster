import path from 'path';
import os from 'os';
import fs from 'fs';
import { simpleGit } from 'simple-git';
import { SemverBumper, BumpType } from '../../src/release/semver';

async function makeTmpRepo(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-test-'));
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig('user.email', 'test@example.com');
  await git.addConfig('user.name', 'Test');
  // initial commit so HEAD exists
  fs.writeFileSync(path.join(dir, 'README.md'), '# test');
  await git.add('.');
  await git.commit('init');
  return dir;
}

describe('SemverBumper', () => {
  let repoPath: string;
  let bumper: SemverBumper;

  beforeEach(async () => {
    repoPath = await makeTmpRepo();
    bumper = new SemverBumper(repoPath);
  });

  afterEach(() => {
    fs.rmSync(repoPath, { recursive: true, force: true });
  });

  test('latestTag returns null when no tags exist', async () => {
    const tag = await bumper.latestTag();
    expect(tag).toBeNull();
  });

  test('nextVersion starts at 0.1.0 from scratch with minor bump', async () => {
    const version = await bumper.nextVersion('minor');
    expect(version).toBe('0.1.0');
  });

  test('nextVersion starts at 0.0.1 from scratch with patch bump', async () => {
    const version = await bumper.nextVersion('patch');
    expect(version).toBe('0.0.1');
  });

  test('nextVersion bumps correctly from existing tag', async () => {
    const git = simpleGit(repoPath);
    await git.addAnnotatedTag('1.2.3', 'Release 1.2.3');

    expect(await bumper.nextVersion('patch')).toBe('1.2.4');
    expect(await bumper.nextVersion('minor')).toBe('1.3.0');
    expect(await bumper.nextVersion('major')).toBe('2.0.0');
  });

  test('tagExists returns false when tag not present', async () => {
    expect(await bumper.tagExists('1.0.0')).toBe(false);
  });

  test('tagExists returns true after tagging', async () => {
    const git = simpleGit(repoPath);
    await git.addAnnotatedTag('1.0.0', 'Release');
    expect(await bumper.tagExists('1.0.0')).toBe(true);
  });

  test('hasPostReleaseRun returns false when no commits after tag', async () => {
    const git = simpleGit(repoPath);
    await git.addAnnotatedTag('1.0.0', 'Release');
    expect(await bumper.hasPostReleaseRun('1.0.0')).toBe(false);
  });

  test('hasPostReleaseRun returns true after additional commit', async () => {
    const git = simpleGit(repoPath);
    await git.addAnnotatedTag('1.0.0', 'Release');
    fs.writeFileSync(path.join(repoPath, 'extra.txt'), 'change');
    await git.add('.');
    await git.commit('chore: post-release');
    expect(await bumper.hasPostReleaseRun('1.0.0')).toBe(true);
  });
});
