import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import simpleGit, { type SimpleGit } from 'simple-git'
import { createSemanticConflictDetector } from '../../src/integration/semantic'
import { createWorktreeManager, type WorktreeManager } from '../../src/integration/worktrees'

/**
 * Proves the spec's third outstanding QC checklist item against a real
 * `tsc --noEmit` run rather than a fake ExecFn returning hand-written output:
 * two branches, each a genuine git worktree of a sample repo, where one
 * branch widens a shared function's signature without updating the other
 * branch's call site. `SemanticConflictDetector` shells out to the real
 * TypeScript compiler (via `createDefaultExec`) in each worktree and must
 * surface a genuine TS2554 arity error as a cross-branch conflict.
 */
describe('semantic conflict detection (sample repo)', () => {
  let repoRoot: string
  let git: SimpleGit
  let manager: WorktreeManager
  const mathFile = path.join('src', 'shared', 'math.ts')
  const billingFile = path.join('src', 'billing', 'index.ts')
  const createdWorktrees: string[] = []

  beforeAll(async () => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'harbormaster-semantic-repo-'))
    git = simpleGit(repoRoot)

    await git.init()
    await git.addConfig('user.name', 'Harbormaster Test')
    await git.addConfig('user.email', 'test@harbormaster.local')

    writeFileSync(
      path.join(repoRoot, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2020',
            module: 'commonjs',
            strict: true,
            noEmit: true,
            skipLibCheck: true,
          },
          include: ['src/**/*.ts'],
        },
        null,
        2,
      ),
    )

    mkdirSync(path.join(repoRoot, 'src', 'shared'), { recursive: true })
    mkdirSync(path.join(repoRoot, 'src', 'billing'), { recursive: true })
    writeFileSync(
      path.join(repoRoot, mathFile),
      'export function add(a: number, b: number): number {\n  return a + b\n}\n',
    )
    writeFileSync(
      path.join(repoRoot, billingFile),
      "import { add } from '../shared/math'\n\nexport const total = add(1, 2)\n",
    )
    await git.add('.')
    await git.commit('initial commit')
    await git.branch(['-M', 'main'])

    manager = createWorktreeManager(git, repoRoot, path.join(repoRoot, '.worktrees'))
  }, 30_000)

  afterAll(async () => {
    for (const dispatchId of createdWorktrees) {
      await manager.remove(dispatchId).catch(() => {})
    }
    await git.raw(['worktree', 'prune']).catch(() => {})
    rmSync(repoRoot, { recursive: true, force: true })
  })

  it('catches a real signature-breaking change via tsc across two branches', async () => {
    // Branch A widens the shared `add` signature to a required third
    // parameter, but never touches billing/index.ts — a genuine change
    // that breaks a caller it doesn't know about.
    const worktreeA = await manager.create({
      dispatchId: 'dispatch-a',
      branch: 'agent/dispatch-a',
      baseBranch: 'main',
    })
    createdWorktrees.push('dispatch-a')

    writeFileSync(
      path.join(worktreeA.path, mathFile),
      'export function add(a: number, b: number, c: number): number {\n  return a + b + c\n}\n',
    )
    const gitA = simpleGit(worktreeA.path)
    await gitA.add('.')
    await gitA.commit('widen add() to take a third parameter')

    // Branch B is concurrently working on billing/index.ts (unrelated
    // addition), unaware of branch A's signature change.
    const worktreeB = await manager.create({
      dispatchId: 'dispatch-b',
      branch: 'agent/dispatch-b',
      baseBranch: 'main',
    })
    createdWorktrees.push('dispatch-b')

    writeFileSync(
      path.join(worktreeB.path, billingFile),
      "import { add } from '../shared/math'\n\nexport const total = add(1, 2)\nexport const label = 'billing'\n",
    )
    const gitB = simpleGit(worktreeB.path)
    await gitB.add('.')
    await gitB.commit('add a billing label export')

    // Real detector, real `npx tsc --noEmit` per worktree (no tsconfigPath
    // override — each worktree carries its own tsconfig.json, discovered by
    // tsc's normal upward directory search from cwd).
    const detector = createSemanticConflictDetector()

    const report = await detector.detect([
      {
        branchName: 'agent/dispatch-a',
        worktreePath: worktreeA.path,
        changedFiles: [mathFile.replace(/\\/g, '/')],
      },
      {
        branchName: 'agent/dispatch-b',
        worktreePath: worktreeB.path,
        changedFiles: [billingFile.replace(/\\/g, '/')],
      },
    ])

    const resultA = report.branchResults.find(r => r.branchName === 'agent/dispatch-a')!
    const resultB = report.branchResults.find(r => r.branchName === 'agent/dispatch-b')!

    // Branch A's own worktree fails a real typecheck: it still contains the
    // unmodified billing/index.ts, which now calls the widened `add` with
    // only two arguments.
    expect(resultA.clean).toBe(false)
    expect(resultA.errors).toContainEqual(
      expect.objectContaining({
        file: billingFile.replace(/\\/g, '/'),
        code: 'TS2554',
        severity: 'error',
        message: expect.stringContaining('Expected 3 arguments, but got 2'),
      }),
    )

    // Branch B never touched math.ts, so its own worktree still has the
    // original two-argument `add` and typechecks clean.
    expect(resultB.clean).toBe(true)
    expect(resultB.errors).toHaveLength(0)

    // The cross-reference must flag this as a real conflict: branch A has
    // type errors in a file branch B is actively modifying.
    expect(report.hasConflicts).toBe(true)
    expect(report.crossBranchConflicts).toHaveLength(1)
    const conflict = report.crossBranchConflicts[0]
    expect(conflict.branchA).toBe('agent/dispatch-a')
    expect(conflict.branchB).toBe('agent/dispatch-b')
    expect(conflict.filesInvolved).toContain(billingFile.replace(/\\/g, '/'))
    expect(conflict.description).toContain(
      'agent/dispatch-a has type errors in files modified by agent/dispatch-b',
    )
  }, 30_000)
})
