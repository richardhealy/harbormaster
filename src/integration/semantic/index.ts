import { spawn } from 'child_process'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { simpleGit } from 'simple-git'
import type {
  InFlightBranch,
  MergeViewFactory,
  PairCheckResult,
  SemanticCheckResult,
  TypecheckResult,
  TypecheckRunner,
} from './types'

export type {
  InFlightBranch,
  MergeViewFactory,
  PairCheckResult,
  PairOutcome,
  SemanticCheckResult,
  TypecheckResult,
  TypecheckRunner,
} from './types'

/**
 * Detects semantic conflicts between pairs of in-flight agent branches.
 *
 * Each pair is checked by typechecking a merged view that overlays branch B's
 * changed files on top of branch A's worktree.  Errors that appear in the
 * merged view but not in either branch alone are semantic conflicts — the
 * canonical case is a signature change in A that breaks a caller B left
 * untouched.
 */
export class SemanticConflictDetector {
  constructor(
    private readonly typecheckRunner: TypecheckRunner,
    private readonly mergeViewFactory: MergeViewFactory,
  ) {}

  /**
   * Check two in-flight branches for semantic conflicts.
   *
   * 1. Typecheck branch A and B concurrently to capture their existing errors.
   * 2. Build a merged view (A as base, B's changed files overlaid).
   * 3. Typecheck the merged view.
   * 4. Any error in the merged view that does not appear in A or B alone is a
   *    cross-branch semantic conflict.
   */
  async checkPair(
    branchA: InFlightBranch,
    branchB: InFlightBranch,
  ): Promise<PairCheckResult> {
    let mergeDir: string | undefined

    try {
      const [resultA, resultB] = await Promise.all([
        this.typecheckRunner(branchA.worktreePath),
        this.typecheckRunner(branchB.worktreePath),
      ])

      mergeDir = await this.mergeViewFactory.create(branchA.worktreePath, branchB.worktreePath)
      const mergedResult = await this.typecheckRunner(mergeDir)

      if (mergedResult.clean) {
        return {
          dispatchIdA: branchA.dispatchId,
          dispatchIdB: branchB.dispatchId,
          outcome: 'clean',
          newErrors: [],
        }
      }

      const knownErrors = new Set([...resultA.errors, ...resultB.errors])
      const newErrors = mergedResult.errors.filter(e => !knownErrors.has(e))

      if (newErrors.length > 0) {
        return {
          dispatchIdA: branchA.dispatchId,
          dispatchIdB: branchB.dispatchId,
          outcome: 'conflict',
          newErrors,
        }
      }

      // Merged view has errors but all pre-exist in one of the individual branches
      return {
        dispatchIdA: branchA.dispatchId,
        dispatchIdB: branchB.dispatchId,
        outcome: 'clean',
        newErrors: [],
        message: 'Merged view errors all pre-exist in individual branches',
      }
    } catch (err) {
      return {
        dispatchIdA: branchA.dispatchId,
        dispatchIdB: branchB.dispatchId,
        outcome: 'error',
        newErrors: [],
        message: String(err),
      }
    } finally {
      if (mergeDir !== undefined) {
        await this.mergeViewFactory.cleanup(mergeDir).catch(() => {})
      }
    }
  }

  /**
   * Check all unique pairs of in-flight branches for semantic conflicts.
   * All pairs are checked concurrently.
   */
  async checkAll(branches: InFlightBranch[]): Promise<SemanticCheckResult> {
    if (branches.length < 2) {
      return { conflicts: [], allPairs: [], checkedPairs: 0, clean: true }
    }

    const pairs: [InFlightBranch, InFlightBranch][] = []
    for (let i = 0; i < branches.length; i++) {
      for (let j = i + 1; j < branches.length; j++) {
        pairs.push([branches[i], branches[j]])
      }
    }

    const allPairs = await Promise.all(pairs.map(([a, b]) => this.checkPair(a, b)))
    const conflicts = allPairs.filter(r => r.outcome === 'conflict')

    return {
      conflicts,
      allPairs,
      checkedPairs: allPairs.length,
      clean: conflicts.length === 0,
    }
  }
}

/**
 * Default TypecheckRunner: invokes `npx tsc --noEmit` in the given directory
 * and extracts `error TSxxxx` lines from the output.
 */
export function createTypecheckRunner(tsconfigPath?: string): TypecheckRunner {
  return (workingDir: string): Promise<TypecheckResult> => {
    const args = ['tsc', '--noEmit']
    if (tsconfigPath) args.push('--project', tsconfigPath)

    return new Promise(resolve => {
      const chunks: string[] = []
      const proc = spawn('npx', args, { cwd: workingDir, shell: false })

      proc.stdout.on('data', (d: Buffer) => chunks.push(d.toString()))
      proc.stderr.on('data', (d: Buffer) => chunks.push(d.toString()))

      proc.on('close', (code: number | null) => {
        const output = chunks.join('')
        const errors = output
          .split('\n')
          .filter(l => /error TS\d+/.test(l))
          .map(l => l.trim())
          .filter(Boolean)
        resolve({ clean: code === 0, errors, output })
      })

      proc.on('error', (err: Error) => {
        resolve({ clean: false, errors: [err.message], output: err.message })
      })
    })
  }
}

/**
 * Default MergeViewFactory: copies branch A's worktree into a temp directory,
 * then overlays the files that branch B changed (relative to the common
 * ancestor on 'main') to approximate a merged state.
 *
 * If the git history prevents finding a common ancestor, the overlay step is
 * skipped silently — the temp dir still contains branch A's state.
 */
export function createMergeViewFactory(tempBase?: string): MergeViewFactory {
  const base = tempBase ?? path.join(os.tmpdir(), 'harbormaster-semantic')

  return {
    async create(worktreeA: string, worktreeB: string): Promise<string> {
      const tempDir = path.join(base, `merge-${process.hrtime.bigint()}`)
      await fs.mkdir(tempDir, { recursive: true })
      await fs.cp(worktreeA, tempDir, { recursive: true })

      try {
        const git = simpleGit(worktreeB)
        const baseSha = (await git.raw(['merge-base', 'HEAD', 'main'])).trim()
        const diffOut = await git.raw([
          'diff',
          '--name-only',
          '--diff-filter=ACM',
          baseSha,
          'HEAD',
        ])
        const changedFiles = diffOut
          .split('\n')
          .map(l => l.trim())
          .filter(Boolean)

        for (const file of changedFiles) {
          const src = path.join(worktreeB, file)
          const dst = path.join(tempDir, file)
          await fs.mkdir(path.dirname(dst), { recursive: true })
          await fs.copyFile(src, dst).catch(() => {})
        }
      } catch {
        // No common ancestor or other git failure — temp dir still holds A's state
      }

      return tempDir
    },

    async cleanup(dir: string): Promise<void> {
      await fs.rm(dir, { recursive: true, force: true })
    },
  }
}
