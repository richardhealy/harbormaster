import type { SimpleGit } from 'simple-git'

/**
 * Merges source (main) into target (develop).
 * When the only conflict is package.json — a common case when the release
 * branch bumped the version — the conflict is auto-resolved by keeping the
 * target's (develop's) version of the file.
 */
export async function syncDevelop(
  git: SimpleGit,
  source: string = 'main',
  target: string = 'develop',
): Promise<void> {
  await git.checkout(target)

  try {
    await git.merge([source])
  } catch {
    await git.checkout(['--ours', 'package.json'])
    await git.add(['package.json'])
    await git.commit(`chore: sync ${target} from ${source}`)
  }
}
