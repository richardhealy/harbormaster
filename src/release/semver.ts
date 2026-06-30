import semver from 'semver'
import type { SimpleGit } from 'simple-git'
import type { VersionBump } from './types'

/** Bumps a semver string by `type` (e.g. `'minor'`, `'patch'`). Throws if `current` isn't valid semver. */
export function bumpVersion(current: string, type: VersionBump): string {
  const bumped = semver.inc(current, type)
  if (!bumped) throw new Error(`Invalid semver: ${current}`)
  return bumped
}

/** Returns the highest version tag in the repo, or `null` if there are none (or the lookup fails). */
export async function getLatestTag(git: SimpleGit): Promise<string | null> {
  try {
    const tags = await git.tags(['--sort=-version:refname'])
    return tags.latest ?? null
  } catch {
    return null
  }
}

/** Bumps from the latest tag, treating a tag-less repo as starting from `0.0.0`. Strips a leading `v` from the tag before parsing. */
export async function bumpFromLatestTag(git: SimpleGit, type: VersionBump): Promise<string> {
  const latestTag = await getLatestTag(git)
  const current = latestTag ? latestTag.replace(/^v/, '') : '0.0.0'
  return bumpVersion(current, type)
}
