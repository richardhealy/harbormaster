import semver from 'semver'
import type { ReleaseVersion, SemverBump } from './types.js'

export function parseVersion(raw: string): ReleaseVersion {
  const cleaned = semver.clean(raw)
  if (!cleaned) throw new Error(`Invalid semver: ${raw}`)

  const parsed = semver.parse(cleaned)
  if (!parsed) throw new Error(`Failed to parse semver: ${cleaned}`)

  return {
    major: parsed.major,
    minor: parsed.minor,
    patch: parsed.patch,
    raw: cleaned,
  }
}

export function bumpVersion(current: string, bump: SemverBump): string {
  const next = semver.inc(current, bump)
  if (!next) throw new Error(`Cannot bump ${current} as ${bump}`)
  return next
}

export function nextPatchVersion(tags: string[]): string {
  if (tags.length === 0) return '0.1.0'

  const versions = tags
    .map((t) => semver.clean(t))
    .filter((v): v is string => v !== null)
    .sort(semver.rcompare)

  const latest = versions[0]
  if (!latest) return '0.1.0'

  return bumpVersion(latest, 'patch')
}

export function latestTag(tags: string[]): string | null {
  const versions = tags
    .map((t) => semver.clean(t))
    .filter((v): v is string => v !== null)
    .sort(semver.rcompare)

  return versions[0] ?? null
}

export function compareVersions(a: string, b: string): number {
  return semver.compare(a, b)
}

export function formatBranchVersion(version: string): string {
  const v = parseVersion(version)
  return `${v.major}.${v.minor}`
}

export function isPreRelease(version: string): boolean {
  const parsed = semver.parse(version)
  return (parsed?.prerelease.length ?? 0) > 0
}
