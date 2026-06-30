import semver from 'semver'
import type { SimpleGit } from 'simple-git'
import type { VersionBump } from './types'

/** Bumps `current` by `type` (major/minor/patch/etc.) using `semver.inc`. Throws if `current` isn't a valid semver string. */
export function bumpVersion(current: string, type: VersionBump): string {
  const bumped = semver.inc(current, type)
  if (!bumped) throw new Error(`Invalid semver: ${current}`)
  return bumped
}

/** Returns the highest version tag in the repo (sorted by semver, not creation date), or `null` if there are none or the lookup fails. */
export async function getLatestTag(git: SimpleGit): Promise<string | null> {
  try {
    const tags = await git.tags(['--sort=-version:refname'])
    return tags.latest ?? null
  } catch {
    return null
  }
}

/** Resolves the latest tag (defaulting to `0.0.0` if there isn't one) and bumps it by `type`. The `v` prefix, if present, is stripped before bumping. */
export async function bumpFromLatestTag(git: SimpleGit, type: VersionBump): Promise<string> {
  const latestTag = await getLatestTag(git)
  const current = latestTag ? latestTag.replace(/^v/, '') : '0.0.0'
  return bumpVersion(current, type)
}
