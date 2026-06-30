/**
 * Branch creation helpers ported from release.sh's `create-branch` and
 * `auto-next-release` commands.
 */
import type { SimpleGit } from 'simple-git'
import type { BranchNameOptions, ReleaseContext } from './types'
import { bumpFromLatestTag } from './semver'

/**
 * Produces a branch name following the convention: <type>/<ticketId>/<slug>
 * e.g. feat/ENG-123/add-user-auth
 *
 * Combining the conventional-commit type with the ticket id keeps branch
 * names sortable/greppable and lets tooling (CI, the scheduler) infer both
 * the change category and the originating ticket from the branch name alone.
 */
export function featureBranchName({ type, ticketId, description }: BranchNameOptions): string {
  const slug = description.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
  return `${type}/${ticketId}/${slug}`
}

/**
 * Cuts a `release/<version>` branch off `base` (main by default). This is
 * the direct port of release.sh's `create-branch` command.
 */
export async function createReleaseBranch(
  git: SimpleGit,
  version: string,
  base: string = 'main',
): Promise<ReleaseContext> {
  const branch = `release/${version}`
  await git.checkoutBranch(branch, base)
  return { version, branch, tag: `v${version}`, baseBranch: base }
}

/**
 * Bumps to the next minor (or patch) version off the latest tag and creates
 * the release branch from main.
 */
export async function autoNextRelease(
  git: SimpleGit,
  type: 'minor' | 'patch' = 'minor',
): Promise<ReleaseContext> {
  const version = await bumpFromLatestTag(git, type)
  return createReleaseBranch(git, version)
}
