/**
 * Tagging helpers ported from release.sh's `tag-main` command, including the
 * idempotency guards that let the script be re-run safely after a partial
 * or repeated invocation (e.g. CI retries) without double-tagging main or
 * re-running post-release steps.
 */
import type { SimpleGit } from 'simple-git'

/** Checks whether `tag` already exists in the repo. */
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
 * Guards (ported verbatim from release.sh, where they prevented re-running
 * the script from corrupting release history):
 * 1. tag-exists: aborts if the tag was already created. Without this guard,
 *    re-running tag-main would attempt to recreate an existing tag, either
 *    failing noisily or, with a force-tag, silently moving a tag that other
 *    systems (CI, deploy tooling) already trust as immutable.
 * 2. has_post_release_run: aborts if commits already exist after this tag,
 *    meaning the release cycle already ran and we would be double-tagging —
 *    i.e. minting a second "v1.2.3" pointing at the wrong commit, or
 *    re-triggering whatever post-release automation watches for new tags.
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
