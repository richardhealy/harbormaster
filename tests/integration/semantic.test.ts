import { describe, it, expect } from 'vitest'
import {
  SemanticConflictDetector,
  createSemanticConflictDetector,
} from '../../src/integration/semantic/index'
import type { BranchInput, ExecFn } from '../../src/integration/semantic/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeExec(outputs: Record<string, string>): ExecFn {
  return async (_command: string, cwd: string) => ({
    stdout: outputs[cwd] ?? '',
    stderr: '',
    exitCode: 0,
  })
}

const CLEAN = ''
const ERROR_FOO =
  "src/foo.ts(10,5): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'."
const WARN_BAR = "src/bar.ts(3,1): warning TS6133: 'x' is declared but its value is never read."

// ---------------------------------------------------------------------------
// parseTscOutput
// ---------------------------------------------------------------------------

describe('SemanticConflictDetector.parseTscOutput', () => {
  const d = new SemanticConflictDetector(makeExec({}))

  it('returns an empty array for empty output', () => {
    expect(d.parseTscOutput('')).toEqual([])
  })

  it('parses a single error line into a TypeScriptError', () => {
    const [err] = d.parseTscOutput(ERROR_FOO)
    expect(err).toMatchObject({
      file: 'src/foo.ts',
      line: 10,
      column: 5,
      code: 'TS2345',
      severity: 'error',
      message: "Argument of type 'string' is not assignable to parameter of type 'number'.",
    })
  })

  it('parses warning severity correctly', () => {
    const [warn] = d.parseTscOutput(WARN_BAR)
    expect(warn.severity).toBe('warning')
    expect(warn.code).toBe('TS6133')
    expect(warn.file).toBe('src/bar.ts')
    expect(warn.line).toBe(3)
  })

  it('parses multiple lines from multi-line tsc output', () => {
    const output = [
      ERROR_FOO,
      WARN_BAR,
      'Found 2 errors in 2 files.',
      '',
      'Errors  Files',
      '     1  src/foo.ts',
    ].join('\n')
    const errors = d.parseTscOutput(output)
    expect(errors).toHaveLength(2)
    expect(errors[0].file).toBe('src/foo.ts')
    expect(errors[1].file).toBe('src/bar.ts')
  })

  it('ignores non-diagnostic summary lines', () => {
    const output = `Found 3 errors.\nErrors  Files\n     3  src/foo.ts\n\nsome random text`
    expect(d.parseTscOutput(output)).toHaveLength(0)
  })

  it('handles paths with directory separators', () => {
    const line = `src/components/Button.tsx(20,3): error TS2339: Property 'x' does not exist.`
    const [err] = d.parseTscOutput(line)
    expect(err.file).toBe('src/components/Button.tsx')
    expect(err.line).toBe(20)
    expect(err.column).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// checkBranch
// ---------------------------------------------------------------------------

describe('SemanticConflictDetector.checkBranch', () => {
  const branch: BranchInput = {
    branchName: 'feat/a',
    worktreePath: '/wt/a',
    changedFiles: ['src/foo.ts'],
  }

  it('returns clean:true with no errors for clean tsc output', async () => {
    const d = new SemanticConflictDetector(makeExec({ '/wt/a': CLEAN }))
    const result = await d.checkBranch(branch)
    expect(result.clean).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.branchName).toBe('feat/a')
  })

  it('returns clean:false when tsc output contains errors', async () => {
    const d = new SemanticConflictDetector(makeExec({ '/wt/a': ERROR_FOO }))
    const result = await d.checkBranch(branch)
    expect(result.clean).toBe(false)
    expect(result.errors).toHaveLength(1)
  })

  it('records durationMs as a non-negative number', async () => {
    const d = new SemanticConflictDetector(makeExec({ '/wt/a': CLEAN }))
    const result = await d.checkBranch(branch)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(typeof result.durationMs).toBe('number')
  })

  it('executes the command in the branch worktree directory', async () => {
    let capturedCwd = ''
    const exec: ExecFn = async (_cmd, cwd) => {
      capturedCwd = cwd
      return { stdout: '', stderr: '', exitCode: 0 }
    }
    const d = new SemanticConflictDetector(exec)
    await d.checkBranch({ branchName: 'x', worktreePath: '/custom/path', changedFiles: [] })
    expect(capturedCwd).toBe('/custom/path')
  })

  it('includes tsc in the executed command', async () => {
    let capturedCmd = ''
    const exec: ExecFn = async (cmd, _cwd) => {
      capturedCmd = cmd
      return { stdout: '', stderr: '', exitCode: 0 }
    }
    const d = new SemanticConflictDetector(exec)
    await d.checkBranch({ branchName: 'x', worktreePath: '/wt', changedFiles: [] })
    expect(capturedCmd).toContain('tsc')
    expect(capturedCmd).toContain('--noEmit')
  })

  it('includes --project flag when tsconfigPath is provided', async () => {
    let capturedCmd = ''
    const exec: ExecFn = async (cmd, _cwd) => {
      capturedCmd = cmd
      return { stdout: '', stderr: '', exitCode: 0 }
    }
    const d = new SemanticConflictDetector(exec, '/project/tsconfig.json')
    await d.checkBranch({ branchName: 'x', worktreePath: '/wt', changedFiles: [] })
    expect(capturedCmd).toContain('--project /project/tsconfig.json')
  })
})

// ---------------------------------------------------------------------------
// detect
// ---------------------------------------------------------------------------

describe('SemanticConflictDetector.detect', () => {
  it('returns an empty report for zero branches', async () => {
    const d = new SemanticConflictDetector(makeExec({}))
    const report = await d.detect([])
    expect(report.branchResults).toHaveLength(0)
    expect(report.crossBranchConflicts).toHaveLength(0)
    expect(report.hasConflicts).toBe(false)
  })

  it('reports no conflicts when all branches are clean', async () => {
    const exec = makeExec({ '/wt/a': CLEAN, '/wt/b': CLEAN })
    const d = new SemanticConflictDetector(exec)
    const report = await d.detect([
      { branchName: 'feat/a', worktreePath: '/wt/a', changedFiles: ['src/a.ts'] },
      { branchName: 'feat/b', worktreePath: '/wt/b', changedFiles: ['src/b.ts'] },
    ])
    expect(report.hasConflicts).toBe(false)
    expect(report.crossBranchConflicts).toHaveLength(0)
    expect(report.branchResults).toHaveLength(2)
  })

  it('detects conflict when A has errors in files changed by B', async () => {
    // feat/a worktree has a type error inside src/b.ts — a file that feat/b modified
    const exec = makeExec({
      '/wt/a': `src/b.ts(5,3): error TS2345: Type mismatch.`,
      '/wt/b': CLEAN,
    })
    const d = new SemanticConflictDetector(exec)
    const report = await d.detect([
      { branchName: 'feat/a', worktreePath: '/wt/a', changedFiles: ['src/a.ts'] },
      { branchName: 'feat/b', worktreePath: '/wt/b', changedFiles: ['src/b.ts'] },
    ])
    expect(report.hasConflicts).toBe(true)
    expect(report.crossBranchConflicts).toHaveLength(1)
    const conflict = report.crossBranchConflicts[0]
    expect(conflict.branchA).toBe('feat/a')
    expect(conflict.branchB).toBe('feat/b')
    expect(conflict.filesInvolved).toContain('src/b.ts')
    expect(conflict.description).toBeTruthy()
  })

  it('detects conflict when B has errors in files changed by A', async () => {
    const exec = makeExec({
      '/wt/a': CLEAN,
      '/wt/b': `src/a.ts(3,1): error TS2551: Property 'foo' does not exist on type 'Bar'.`,
    })
    const d = new SemanticConflictDetector(exec)
    const report = await d.detect([
      { branchName: 'feat/a', worktreePath: '/wt/a', changedFiles: ['src/a.ts'] },
      { branchName: 'feat/b', worktreePath: '/wt/b', changedFiles: ['src/b.ts'] },
    ])
    expect(report.hasConflicts).toBe(true)
    expect(report.crossBranchConflicts).toHaveLength(1)
    expect(report.crossBranchConflicts[0].filesInvolved).toContain('src/a.ts')
    expect(report.crossBranchConflicts[0].description).toMatch(/feat\/b.*feat\/a/)
  })

  it('detects shared-error-file conflict when both branches have errors in the same file', async () => {
    const exec = makeExec({
      '/wt/a': `src/shared.ts(1,1): error TS1001: Error A.`,
      '/wt/b': `src/shared.ts(2,2): error TS1002: Error B.`,
    })
    const d = new SemanticConflictDetector(exec)
    const report = await d.detect([
      { branchName: 'feat/a', worktreePath: '/wt/a', changedFiles: ['src/a.ts'] },
      { branchName: 'feat/b', worktreePath: '/wt/b', changedFiles: ['src/b.ts'] },
    ])
    expect(report.crossBranchConflicts).toHaveLength(1)
    expect(report.crossBranchConflicts[0].filesInvolved).toContain('src/shared.ts')
  })

  it('does not report cross-branch conflict when A only has errors in its own changed files', async () => {
    // feat/a errors are in src/a.ts (which A changed, not B) — not a cross-branch issue
    const exec = makeExec({
      '/wt/a': `src/a.ts(10,5): error TS2345: Error in A's own file.`,
      '/wt/b': CLEAN,
    })
    const d = new SemanticConflictDetector(exec)
    const report = await d.detect([
      { branchName: 'feat/a', worktreePath: '/wt/a', changedFiles: ['src/a.ts'] },
      { branchName: 'feat/b', worktreePath: '/wt/b', changedFiles: ['src/b.ts'] },
    ])
    expect(report.crossBranchConflicts).toHaveLength(0)
    // Branch-level error still flags hasConflicts
    expect(report.hasConflicts).toBe(true)
    expect(report.branchResults[0].clean).toBe(false)
  })

  it('handles three branches and detects the A–B conflict while C stays clean', async () => {
    const exec = makeExec({
      '/wt/a': `src/shared.ts(1,1): error TS1001: Error.`,
      '/wt/b': `src/shared.ts(2,2): error TS1002: Error.`,
      '/wt/c': CLEAN,
    })
    const d = new SemanticConflictDetector(exec)
    const branches: BranchInput[] = [
      { branchName: 'feat/a', worktreePath: '/wt/a', changedFiles: ['src/a.ts'] },
      { branchName: 'feat/b', worktreePath: '/wt/b', changedFiles: ['src/b.ts'] },
      { branchName: 'feat/c', worktreePath: '/wt/c', changedFiles: ['src/c.ts'] },
    ]
    const report = await d.detect(branches)
    expect(report.branchResults).toHaveLength(3)
    const abConflict = report.crossBranchConflicts.find(
      c =>
        (c.branchA === 'feat/a' && c.branchB === 'feat/b') ||
        (c.branchA === 'feat/b' && c.branchB === 'feat/a'),
    )
    expect(abConflict).toBeDefined()
    // feat/c is clean — no conflicts involving it
    const cConflict = report.crossBranchConflicts.find(
      c => c.branchA === 'feat/c' || c.branchB === 'feat/c',
    )
    expect(cConflict).toBeUndefined()
  })

  it('deduplicates file entries in filesInvolved', async () => {
    // B has errors in src/a.ts (changed by A), and both have errors there — should not duplicate
    const exec = makeExec({
      '/wt/a': `src/a.ts(1,1): error TS1001: A's error.`,
      '/wt/b': `src/a.ts(2,2): error TS1002: B sees A's file broken.`,
    })
    const d = new SemanticConflictDetector(exec)
    const report = await d.detect([
      { branchName: 'feat/a', worktreePath: '/wt/a', changedFiles: ['src/a.ts'] },
      { branchName: 'feat/b', worktreePath: '/wt/b', changedFiles: ['src/b.ts'] },
    ])
    const conflict = report.crossBranchConflicts[0]
    const count = conflict.filesInvolved.filter(f => f === 'src/a.ts').length
    expect(count).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

describe('createSemanticConflictDetector', () => {
  it('returns a SemanticConflictDetector instance', () => {
    const detector = createSemanticConflictDetector()
    expect(detector).toBeInstanceOf(SemanticConflictDetector)
  })
})
