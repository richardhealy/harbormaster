import semver from 'semver'
import type { SimpleGit } from 'simple-git'
import type { VersionBump } from './types'

export function bumpVersion(current: string, type: VersionBump): string {
  const bumped = semver.inc(current, type)
  if (!bumped) throw new Error(`Invalid semver: ${current}`)
  return bumped
}

export async function getLatestTag(git: SimpleGit): Promise<string | null> {
  try {
    const tags = await git.tags(['--sort=-version:refname'])
    return tags.latest ?? null
  } catch {
    return null
  }
}

export async function bumpFromLatestTag(git: SimpleGit, type: VersionBump): Promise<string> {
  const latestTag = await getLatestTag(git)
  const current = latestTag ? latestTag.replace(/^v/, '') : '0.0.0'
  return bumpVersion(current, type)
}
