import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import simpleGit, { type SimpleGit } from 'simple-git'
import { exec as execCb } from 'child_process'
import { promisify } from 'util'
import { SemanticConflictDetector } from '../../src/integration/semantic'
import { createWorktreeManager, type WorktreeManager } from '../../src/integration/worktrees'
import type { ExecFn } from '../../src/integration/semantic/types'

const execAsync = promisify(execCb)

/**
 * Proves the spec's third checklist item ("a signature change that breaks a
 * caller on another branch is caught by semantic detection before merge")
 * against a genuine `tsc --noEmit` run instead of a hand-written stdout
 * fixture: two branches, each a real git worktree off the same throwaway
 * sample repo. One breaks a shared function's signature; the other
 * independently edits the caller's file without knowing about it. The
 * actual TypeScript compiler produces the diagnostics; nothing here is
 * scripted.
 *
 * The compiler is resolved from harbormaster's own node_modules and invoked
 * directly (`node <bin/tsc>`) rather than via `npx tsc`, so the test needs
 * neither network access nor a node_modules copy inside each throwaway
 * worktree — but the binary that runs, and the diagnostics it emits, are
 * the real compiler, not a fixture.
 */
describe('semantic conflict detection (sample repo)', () => {
  let repoRoot: string
  let git: SimpleGit
  let manager: WorktreeManager
  const formatFile = 'src/shared/format.ts'
  const invoiceFile = 'src/callers/invoice.ts'
  const createdWorktrees: string[] = []

  const tscBin = require.resolve('typescript/bin/tsc')
  const realExec: ExecFn = async (command, cwd) => {
    const patched = command.replace('npx tsc', `node ${JSON.stringify(tscBin)}`)
    try {
      const { stdout, stderr } = await execAsync(patched, { cwd })
      return { stdout, stderr, exitCode: 0 }
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; code?: number }
      return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', exitCode: e.code ?? 1 }
    }
  }

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
            types: [],
          },
          include: ['src/**/*.ts'],
        },
        null,
        2,
      ),
    )
    mkdirSync(path.join(repoRoot, 'src', 'shared'), { recursive: true })
    mkdirSync(path.join(repoRoot, 'src', 'callers'), { recursive: true })
    writeFileSync(
      path.join(repoRoot, formatFile),
      'export function formatTotal(amount: number): string {\n  return `$${amount.toFixed(2)}`\n}\n',
    )
    writeFileSync(
      path.join(repoRoot, invoiceFile),
      "import { formatTotal } from '../shared/format'\n\nexport function renderInvoice(amount: number): string {\n  return `Total: ${formatTotal(amount)}`\n}\n",
    )
    await git.add('.')
    await git.commit('initial commit')
    await git.branch(['-M', 'main'])

    manager = createWorktreeManager(git, repoRoot, path.join(repoRoot, '.worktrees'))
  }, 20000)

  afterAll(async () => {
    for (const dispatchId of createdWorktrees) {
      await manager.remove(dispatchId).catch(() => {})
    }
    await git.raw(['worktree', 'prune']).catch(() => {})
    rmSync(repoRoot, { recursive: true, force: true })
  })

  it('catches a real cross-branch signature break via genuine tsc --noEmit', async () => {
    // Branch A: breaks formatTotal's signature (adds a required currency
    // param) without touching invoice.ts — a realistic partial edit; the
    // agent working on the shared module has no reason to also touch every
    // caller.
    const worktreeA = await manager.create({
      dispatchId: 'dispatch-sig',
      branch: 'agent/dispatch-sig',
      baseBranch: 'main',
    })
    createdWorktrees.push('dispatch-sig')
    writeFileSync(
      path.join(worktreeA.path, formatFile),
      'export function formatTotal(amount: number, currency: string): string {\n  return `${currency}${amount.toFixed(2)}`\n}\n',
    )
    const gitA = simpleGit(worktreeA.path)
    await gitA.add('.')
    await gitA.commit('formatTotal now requires a currency code')

    // Branch B: independently edits invoice.ts, unaware branch A changed
    // formatTotal's signature.
    const worktreeB = await manager.create({
      dispatchId: 'dispatch-caller',
      branch: 'agent/dispatch-caller',
      baseBranch: 'main',
    })
    createdWorktrees.push('dispatch-caller')
    writeFileSync(
      path.join(worktreeB.path, invoiceFile),
      "import { formatTotal } from '../shared/format'\n\nexport function renderInvoice(amount: number): string {\n  return `Total: ${formatTotal(amount)}`\n}\n\nexport function renderReceipt(amount: number): string {\n  return `Receipt: ${formatTotal(amount)}`\n}\n",
    )
    const gitB = simpleGit(worktreeB.path)
    await gitB.add('.')
    await gitB.commit('add renderReceipt')

    const detector = new SemanticConflictDetector(realExec)
    const report = await detector.detect([
      {
        branchName: 'agent/dispatch-sig',
        worktreePath: worktreeA.path,
        changedFiles: [formatFile],
      },
      {
        branchName: 'agent/dispatch-caller',
        worktreePath: worktreeB.path,
        changedFiles: [invoiceFile],
      },
    ])

    // Branch A's full worktree checkout still carries invoice.ts's original
    // one-argument call site (branch A never touched that file), so the real
    // compiler reports a genuine TS2554 there.
    const branchAResult = report.branchResults.find(r => r.branchName === 'agent/dispatch-sig')!
    expect(branchAResult.clean).toBe(false)
    expect(
      branchAResult.errors.some(e => e.file.endsWith('invoice.ts') && e.code === 'TS2554'),
    ).toBe(true)

    // Branch B, unaware of the signature change, still compiles clean
    // against the original formatTotal — its own diff is fine in isolation.
    const branchBResult = report.branchResults.find(r => r.branchName === 'agent/dispatch-caller')!
    expect(branchBResult.clean).toBe(true)

    // The cross-branch detector connects the dots: branch A's real compiler
    // error lands in invoice.ts, exactly the file branch B changed — flagged
    // as a genuine cross-branch semantic conflict before either merges.
    expect(report.hasConflicts).toBe(true)
    expect(report.crossBranchConflicts).toHaveLength(1)
    expect(report.crossBranchConflicts[0].filesInvolved).toContain(invoiceFile)
  }, 30000)
})
