import { SimpleGit } from 'simple-git';

export interface TagOptions {
  git: SimpleGit;
  mainBranch: string;
}

export interface TagResult {
  tag: string;
  alreadyExisted: boolean;
  sha: string;
}

/**
 * Tag the current tip of main with the given version.
 * Idempotent: if the tag already exists at HEAD, returns without error.
 * Throws if the tag exists but points at a different commit.
 */
export async function tagMain(opts: TagOptions, version: string): Promise<TagResult> {
  const tag = version.startsWith('v') ? version : `v${version}`;

  const existingTags = await opts.git.tags();
  const headSha = await getHeadSha(opts.git, opts.mainBranch);

  if (existingTags.all.includes(tag)) {
    const tagSha = await getTagSha(opts.git, tag);
    if (tagSha !== headSha) {
      throw new Error(
        `Tag ${tag} already exists at ${tagSha} but HEAD of ${opts.mainBranch} is ${headSha}`,
      );
    }
    return { tag, alreadyExisted: true, sha: headSha };
  }

  await opts.git.checkout(opts.mainBranch);
  // Pull latest if a remote is available; safe to skip in offline / test contexts
  await opts.git.pull('origin', opts.mainBranch).catch(() => null);

  const currentSha = await getHeadSha(opts.git, opts.mainBranch);
  await opts.git.addAnnotatedTag(tag, `Release ${tag}`);

  return { tag, alreadyExisted: false, sha: currentSha };
}

/**
 * Check whether a post-release commit exists after the given tag, indicating
 * the release cycle has advanced and auto-next-release should proceed.
 */
export async function hasPostReleaseRun(opts: TagOptions, tag: string): Promise<boolean> {
  const normalizedTag = tag.startsWith('v') ? tag : `v${tag}`;
  const existingTags = await opts.git.tags();

  if (!existingTags.all.includes(normalizedTag)) return false;

  const log = await opts.git.log({ from: normalizedTag, to: opts.mainBranch });
  return log.total > 0;
}

/**
 * Get the list of tags sorted by version (descending), filtering to semver tags.
 */
export async function listReleaseTags(opts: TagOptions): Promise<string[]> {
  const tags = await opts.git.tags(['--sort=-version:refname']);
  return tags.all.filter(t => /^v?\d+\.\d+\.\d+/.test(t));
}

/**
 * Get the latest release tag (highest semver).
 */
export async function latestReleaseTag(opts: TagOptions): Promise<string | undefined> {
  const tags = await listReleaseTags(opts);
  return tags[0];
}

async function getHeadSha(git: SimpleGit, branch: string): Promise<string> {
  const result = await git.raw(['rev-parse', branch]);
  return result.trim();
}

async function getTagSha(git: SimpleGit, tag: string): Promise<string> {
  const result = await git.raw(['rev-list', '-n', '1', tag]);
  return result.trim();
}
