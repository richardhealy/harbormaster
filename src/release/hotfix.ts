/**
 * Hotfix lifecycle, ported from release.sh's `hotfix-start` and
 * `hotfix-finish` commands.
 */
import type { SimpleGit } from 'simple-git'
import { bumpFromLatestTag } from './semver'
import type { HotfixContext } from './types'

/**
 * Starts a hotfix by bumping the latest tag's patch version and creating a
 * hotfix/<version> branch from main (or a custom base).
 */
export async function hotfixStart(
  git: SimpleGit,
  base: string = 'main',
): Promise<HotfixContext> {
  const version = await bumpFromLatestTag(git, 'patch')
  const hotfixBranch = `hotfix/${version}`
  await git.checkoutBranch(hotfixBranch, base)
  return { version, hotfixBranch, sourceBranch: base }
}

/**
 * Finishes a hotfix by merging it into each target branch (fan-out).
 * Defaults to main and develop; also pass any active release branches.
 *
 * A hotfix must land on main (so the fix ships in the next tag), on develop
 * (so future work doesn't regress it), and on every release branch that is
 * currently in flight — otherwise a release branch cut before the hotfix
 * would ship without the fix even though main and develop both have it.
 * Callers are responsible for passing the current set of active release
 * branches in `targets`.
 *
 * Leaves the repo checked out on `hotfixBranch` afterwards so the caller can
 * inspect or delete it.
 */
export async function hotfixFinish(
  git: SimpleGit,
  hotfixBranch: string,
  targets: string[] = ['main', 'develop'],
): Promise<void> {
  for (const target of targets) {
    await git.checkout(target)
    await git.merge([hotfixBranch])
  }
  await git.checkout(hotfixBranch)
}
