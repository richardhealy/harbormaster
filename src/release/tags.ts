import type { SimpleGit } from 'simple-git'

/** Returns whether `tag` already exists in the repo. Returns `false` (not a throw) if the tag lookup itself fails. */
export async function tagExists(git: SimpleGit, tag: string): Promise<boolean> {
  try {
    const tags = await git.tags()
    return tags.all.includes(tag)
  } catch {
    return false
  }
}

/**
 * Checks if commits have been made after the given release tag — used as an
 * idempotency guard to detect whether the post-release cycle has already run.
 */
export async function hasPostReleaseRun(git: SimpleGit, version: string): Promise<boolean> {
  const tag = `v${version}`
  const exists = await tagExists(git, tag)
  if (!exists) return false

  try {
    const log = await git.log({ from: tag, to: 'HEAD' })
    return log.total > 0
  } catch {
    return false
  }
}

/**
 * Tags the current HEAD as the given version on main.
 *
 * Guards:
 * 1. tag-exists: aborts if the tag was already created.
 * 2. has_post_release_run: aborts if commits already exist after this tag,
 *    meaning the release cycle already ran and we would be double-tagging.
 */
export async function tagMain(git: SimpleGit, version: string): Promise<void> {
  const tag = `v${version}`

  if (await tagExists(git, tag)) {
    throw new Error(`Tag ${tag} already exists (idempotency guard)`)
  }

  if (await hasPostReleaseRun(git, version)) {
    throw new Error(`Post-release commits detected for ${version} — release cycle already ran`)
  }

  await git.addTag(tag)
}
