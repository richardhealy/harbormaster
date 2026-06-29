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
