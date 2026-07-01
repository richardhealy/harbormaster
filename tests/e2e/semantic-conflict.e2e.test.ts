import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { exec } from 'child_process'
import path from 'path'
import simpleGit, { type SimpleGit } from 'simple-git'
import { SemanticConflictDetector } from '../../src/integration/semantic'
import { createWorktreeManager, type WorktreeManager } from '../../src/integration/worktrees'
import type { ExecFn, ExecResult } from '../../src/integration/semantic/types'

/**
 * Proves the spec's third checklist item against a real `tsc --noEmit` run
 * rather than a fake ExecFn returning hand-written output: a signature
 * change that breaks a caller left untouched on another branch is caught by
 * SemanticConflictDetector before either branch merges.
 *
 * The only thing swapped out is *how* the compiler binary is resolved (the
 * harbormaster repo's own locally-installed `tsc`, invoked in place of
 * `npx tsc` so the test doesn't depend on network/registry access) — the
 * command that actually runs is the real one `checkBranch` builds, executed
 * as a genuine child process against genuine TypeScript source files.
 */
describe('semantic conflict detection (real tsc)', () => {
  let repoRoot: string
  let git: SimpleGit
  let manager: WorktreeManager
  const createdWorktrees: string[] = []
  const mathFile = path.join('src', 'shared', 'math.ts')
  const callerFile = path.join('src', 'consumer', 'caller.ts')
  const unrelatedFile = path.join('src', 'consumer', 'logger.ts')

  const localTsc = path.resolve(__dirname, '../../node_modules/.bin/tsc')

  // Runs the exact command SemanticConflictDetector builds ("npx tsc ...
  // --noEmit || true"), but resolved against the repo's own installed tsc
  // instead of npx, so the compiler actually runs rather than hitting npm's
  // registry from a sandboxed test run.
  const realExec: ExecFn = (command, cwd) =>
    new Promise<ExecResult>(resolve => {
      const resolved = command.replace('npx tsc', `"${localTsc}"`)
      exec(resolved, { cwd }, (_error, stdout, stderr) => {
        resolve({ stdout: stdout || '', stderr: stderr || '', exitCode: 0 })
      })
    })

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
            moduleResolution: 'node',
            strict: true,
            noEmit: true,
          },
          include: ['src/**/*'],
        },
        null,
        2,
      ),
    )

    mkdirSync(path.join(repoRoot, 'src', 'shared'), { recursive: true })
    mkdirSync(path.join(repoRoot, 'src', 'consumer'), { recursive: true })
    writeFileSync(
      path.join(repoRoot, mathFile),
      'export function add(a: number, b: number): number {\n  return a + b\n}\n',
    )
    writeFileSync(
      path.join(repoRoot, callerFile),
      "import { add } from '../shared/math'\n\nexport function sum(): number {\n  return add(1, 2)\n}\n",
    )
    writeFileSync(path.join(repoRoot, unrelatedFile), 'export const log = (msg: string): void => {}\n')

    await git.add('.')
    await git.commit('initial commit')
    await git.branch(['-M', 'main'])

    manager = createWorktreeManager(git, repoRoot, path.join(repoRoot, '.worktrees'))
  })

  afterAll(async () => {
    for (const dispatchId of createdWorktrees) {
      await manager.remove(dispatchId).catch(() => {})
    }
    await git.raw(['worktree', 'prune']).catch(() => {})
    rmSync(repoRoot, { recursive: true, force: true })
  })

  it('catches a real signature break that only shows up in a caller left untouched by the breaking branch', async () => {
    // Branch A: widens add()'s signature but never touches the caller — a
    // realistic agent change scoped to the file it thinks it owns.
    const worktreeA = await manager.create({
      dispatchId: 'dispatch-signature',
      branch: 'agent/dispatch-signature',
      baseBranch: 'main',
    })
    createdWorktrees.push('dispatch-signature')
    writeFileSync(
      path.join(worktreeA.path, mathFile),
      'export function add(a: number, b: number, c: number): number {\n  return a + b + c\n}\n',
    )
    const gitA = simpleGit(worktreeA.path)
    await gitA.add('.')
    await gitA.commit('widen add() to take a third operand')

    // Branch B: independently touches the caller for an unrelated reason,
    // never learning about branch A's signature change.
    const worktreeB = await manager.create({
      dispatchId: 'dispatch-caller-edit',
      branch: 'agent/dispatch-caller-edit',
      baseBranch: 'main',
    })
    createdWorktrees.push('dispatch-caller-edit')
    writeFileSync(
      path.join(worktreeB.path, callerFile),
      "import { add } from '../shared/math'\n\n// clarify intent\nexport function sum(): number {\n  return add(1, 2)\n}\n",
    )
    const gitB = simpleGit(worktreeB.path)
    await gitB.add('.')
    await gitB.commit('clarify sum() comment')

    const detector = new SemanticConflictDetector(realExec)

    const report = await detector.detect([
      {
        branchName: 'agent/dispatch-signature',
        worktreePath: worktreeA.path,
        changedFiles: [mathFile.replace(/\\/g, '/')],
      },
      {
        branchName: 'agent/dispatch-caller-edit',
        worktreePath: worktreeB.path,
        changedFiles: [callerFile.replace(/\\/g, '/')],
      },
    ])

    // Branch A's own worktree genuinely fails to typecheck: it left the
    // caller calling add() with the old, now-insufficient, arity.
    const resultA = report.branchResults.find(r => r.branchName === 'agent/dispatch-signature')!
    expect(resultA.clean).toBe(false)
    expect(resultA.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'TS2554', file: callerFile.replace(/\\/g, '/') }),
      ]),
    )

    // Branch B's own change type checks fine in isolation.
    const resultB = report.branchResults.find(r => r.branchName === 'agent/dispatch-caller-edit')!
    expect(resultB.clean).toBe(true)
    expect(resultB.errors).toEqual([])

    // The cross-branch check is what actually matters: A's real type error
    // lands in a file B modified, so this is flagged before either merges.
    expect(report.hasConflicts).toBe(true)
    expect(report.crossBranchConflicts).toHaveLength(1)
    const conflict = report.crossBranchConflicts[0]
    expect(conflict.branchA).toBe('agent/dispatch-signature')
    expect(conflict.branchB).toBe('agent/dispatch-caller-edit')
    expect(conflict.filesInvolved).toContain(callerFile.replace(/\\/g, '/'))
    expect(conflict.description).toContain('agent/dispatch-signature has type errors in files modified by agent/dispatch-caller-edit')
  })

  it('does not flag genuinely independent branches that both typecheck clean', async () => {
    const worktreeC = await manager.create({
      dispatchId: 'dispatch-unrelated',
      branch: 'agent/dispatch-unrelated',
      baseBranch: 'main',
    })
    createdWorktrees.push('dispatch-unrelated')
    writeFileSync(
      path.join(worktreeC.path, unrelatedFile),
      "export const log = (msg: string): void => {\n  console.log(msg)\n}\n",
    )
    const gitC = simpleGit(worktreeC.path)
    await gitC.add('.')
    await gitC.commit('add console output to log()')

    const worktreeD = await manager.create({
      dispatchId: 'dispatch-unrelated-2',
      branch: 'agent/dispatch-unrelated-2',
      baseBranch: 'main',
    })
    createdWorktrees.push('dispatch-unrelated-2')
    writeFileSync(
      path.join(worktreeD.path, mathFile),
      'export function add(a: number, b: number): number {\n  // commutative\n  return b + a\n}\n',
    )
    const gitD = simpleGit(worktreeD.path)
    await gitD.add('.')
    await gitD.commit('reorder add() operands')

    const detector = new SemanticConflictDetector(realExec)
    const report = await detector.detect([
      {
        branchName: 'agent/dispatch-unrelated',
        worktreePath: worktreeC.path,
        changedFiles: [unrelatedFile.replace(/\\/g, '/')],
      },
      {
        branchName: 'agent/dispatch-unrelated-2',
        worktreePath: worktreeD.path,
        changedFiles: [mathFile.replace(/\\/g, '/')],
      },
    ])

    expect(report.branchResults.every(r => r.clean)).toBe(true)
    expect(report.crossBranchConflicts).toEqual([])
    expect(report.hasConflicts).toBe(false)
  })
})
