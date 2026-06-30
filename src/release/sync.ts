/**
 * Develop/main sync, ported from release.sh's `sync-develop` command.
 */
import type { SimpleGit } from 'simple-git'

/**
 * Merges source (main) into target (develop).
 *
 * Because main and develop each bump package.json's version independently
 * (a release bumps it on main, ongoing work may bump it on develop too),
 * merging main into develop almost always produces a package.json conflict
 * that has nothing to do with real code changes. Rather than surface that
 * to a human every sync, this auto-resolves by keeping develop's own
 * version of package.json (`checkout --ours`) and committing the merge —
 * develop's version number wins since it's the branch moving forward.
 *
 * Note this catch-and-resolve is unconditional: any merge failure (not only
 * a package.json conflict) triggers the same `--ours package.json` recovery
 * and commit. This mirrors release.sh's original behavior, which assumed
 * package.json was the only realistic source of conflict between main and
 * develop; it is not a verified check that the conflict was limited to
 * package.json.
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
