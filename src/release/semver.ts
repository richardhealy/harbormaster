import semver from 'semver'
import type { SimpleGit } from 'simple-git'
import type { VersionBump } from './types'

/** Bumps a semver string by `type` (e.g. `'minor'`); throws if `current` isn't valid semver. */
export function bumpVersion(current: string, type: VersionBump): string {
  const bumped = semver.inc(current, type)
  if (!bumped) throw new Error(`Invalid semver: ${current}`)
  return bumped
}

/** Returns the highest version-sorted git tag, or `null` if the repo has no tags. */
export async function getLatestTag(git: SimpleGit): Promise<string | null> {
  try {
    const tags = await git.tags(['--sort=-version:refname'])
    return tags.latest ?? null
  } catch {
    return null
  }
}

/** Bumps from the repo's latest tag (defaulting to `0.0.0` if untagged), stripping a leading `v`. */
export async function bumpFromLatestTag(git: SimpleGit, type: VersionBump): Promise<string> {
  const latestTag = await getLatestTag(git)
  const current = latestTag ? latestTag.replace(/^v/, '') : '0.0.0'
  return bumpVersion(current, type)
}
