export interface TagGuards {
  tagExists: (tag: string) => Promise<boolean>
  hasPostReleaseRun: (version: string) => Promise<boolean>
}

export interface TagPlan {
  tag: string
  skip: boolean
  reason?: string
}

export function formatTag(version: string): string {
  return version.startsWith('v') ? version : `v${version}`
}

export function stripTagPrefix(tag: string): string {
  return tag.startsWith('v') ? tag.slice(1) : tag
}

export async function planTagMain(
  version: string,
  guards: TagGuards,
): Promise<TagPlan> {
  const tag = formatTag(version)

  if (await guards.tagExists(tag)) {
    return { tag, skip: true, reason: `tag ${tag} already exists` }
  }

  if (await guards.hasPostReleaseRun(version)) {
    return {
      tag,
      skip: true,
      reason: `post-release already ran for ${version}`,
    }
  }

  return { tag, skip: false }
}

export function buildTagMessage(version: string, notes?: string): string {
  const base = `Release ${formatTag(version)}`
  return notes ? `${base}\n\n${notes}` : base
}
