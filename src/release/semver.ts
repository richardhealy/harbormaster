/**
 * Semver helpers ported from release.sh's version-bumping logic: the script
 * derived the next version from the latest git tag rather than trusting
 * package.json, since package.json can drift across branches.
 */
import semver from 'semver'
import type { SimpleGit } from 'simple-git'
import type { VersionBump } from './types'

/**
 * Applies a semver bump to a version string.
 * @throws if `current` is not a valid semver version.
 */
export function bumpVersion(current: string, type: VersionBump): string {
  const bumped = semver.inc(current, type)
  if (!bumped) throw new Error(`Invalid semver: ${current}`)
  return bumped
}

/**
 * Returns the highest version git tag, or `null` if the repo has no tags
 * (e.g. a brand-new repo) or the tag lookup fails.
 */
export async function getLatestTag(git: SimpleGit): Promise<string | null> {
  try {
    const tags = await git.tags(['--sort=-version:refname'])
    return tags.latest ?? null
  } catch {
    return null
  }
}

/**
 * Computes the next version by bumping off the latest git tag rather than
 * package.json, matching release.sh's source of truth. Falls back to
 * `0.0.0` when there is no prior tag, so the first release becomes `0.0.1`/
 * `0.1.0`/`1.0.0` depending on `type`.
 */
export async function bumpFromLatestTag(git: SimpleGit, type: VersionBump): Promise<string> {
  const latestTag = await getLatestTag(git)
  const current = latestTag ? latestTag.replace(/^v/, '') : '0.0.0'
  return bumpVersion(current, type)
}
