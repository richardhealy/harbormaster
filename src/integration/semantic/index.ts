import type {
  BranchInput,
  BranchCheckResult,
  CrossBranchConflict,
  ExecFn,
  ExecResult,
  SemanticConflictReport,
  TypeScriptError,
} from './types'

export type {
  BranchInput,
  BranchCheckResult,
  CrossBranchConflict,
  SemanticConflictReport,
  TypeScriptError,
  ExecFn,
  ExecResult,
} from './types'

// Matches: path/to/file.ts(line,col): error|warning TSxxxx: message
const TSC_LINE_PATTERN = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/

/**
 * Detects semantic conflicts across in-flight branches by running TypeScript
 * typechecking in each branch's worktree and cross-referencing type errors
 * with the set of files each branch modifies.
 *
 * A cross-branch semantic conflict surfaces when branch A has type errors in
 * files that branch B modified (or vice versa), indicating the two changes
 * are likely to be incompatible at the type level when merged.
 */
export class SemanticConflictDetector {
  constructor(
    private readonly exec: ExecFn,
    private readonly tsconfigPath?: string,
  ) {}

  /** Run TypeScript typechecking in a single branch's worktree */
  async checkBranch(input: BranchInput): Promise<BranchCheckResult> {
    const start = Date.now()
    const projectFlag = this.tsconfigPath ? ` --project ${this.tsconfigPath}` : ''
    const command = `npx tsc${projectFlag} --noEmit 2>&1 || true`

    const result = await this.exec(command, input.worktreePath)
    const output = result.stdout + result.stderr
    const errors = this.parseTscOutput(output)

    return {
      branchName: input.branchName,
      clean: errors.length === 0,
      errors,
      durationMs: Date.now() - start,
    }
  }

  /**
   * Runs semantic conflict detection across all in-flight branches.
   *
   * Each branch is checked in parallel; results are then cross-referenced to
   * identify pairs where one branch's type errors implicate files modified by
   * the other branch.
   */
  async detect(branches: BranchInput[]): Promise<SemanticConflictReport> {
    const branchResults = await Promise.all(branches.map(b => this.checkBranch(b)))
    const crossBranchConflicts = this.findCrossConflicts(branchResults, branches)

    return {
      branchResults,
      crossBranchConflicts,
      hasConflicts:
        crossBranchConflicts.length > 0 || branchResults.some(r => !r.clean),
    }
  }

  /** Parse `tsc --noEmit` stdout into structured TypeScriptError objects */
  parseTscOutput(output: string): TypeScriptError[] {
    const errors: TypeScriptError[] = []

    for (const line of output.split('\n')) {
      const match = TSC_LINE_PATTERN.exec(line.trim())
      if (!match) continue

      const [, file, lineStr, colStr, severity, code, message] = match
      errors.push({
        file,
        line: parseInt(lineStr, 10),
        column: parseInt(colStr, 10),
        code,
        message: message.trim(),
        severity: severity as 'error' | 'warning',
      })
    }

    return errors
  }

  private findCrossConflicts(
    results: BranchCheckResult[],
    branches: BranchInput[],
  ): CrossBranchConflict[] {
    const conflicts: CrossBranchConflict[] = []
    const branchMap = new Map(branches.map(b => [b.branchName, b]))

    for (let i = 0; i < results.length; i++) {
      for (let j = i + 1; j < results.length; j++) {
        const conflict = this.checkPairConflict(
          results[i],
          branchMap.get(results[i].branchName)!,
          results[j],
          branchMap.get(results[j].branchName)!,
        )
        if (conflict) conflicts.push(conflict)
      }
    }

    return conflicts
  }

  /**
   * Detects a semantic conflict between two branches by checking:
   * 1. Branch A has errors in files that branch B modified.
   * 2. Branch B has errors in files that branch A modified.
   * 3. Both branches have errors in the same file (shared error site).
   *
   * Any of these conditions indicates the combination of both branches is
   * likely to fail TypeScript typechecking when merged.
   */
  private checkPairConflict(
    resultA: BranchCheckResult,
    branchA: BranchInput,
    resultB: BranchCheckResult,
    branchB: BranchInput,
  ): CrossBranchConflict | null {
    const changedByA = new Set(branchA.changedFiles)
    const changedByB = new Set(branchB.changedFiles)

    const errorsInBChanges = resultA.errors.filter(e => changedByB.has(e.file))
    const errorsInAChanges = resultB.errors.filter(e => changedByA.has(e.file))
    const sharedErrorFiles = [
      ...new Set(
        resultA.errors
          .filter(eA => resultB.errors.some(eB => eB.file === eA.file))
          .map(e => e.file),
      ),
    ]

    const hasConflict =
      errorsInBChanges.length > 0 || errorsInAChanges.length > 0 || sharedErrorFiles.length > 0

    if (!hasConflict) return null

    const filesInvolved = [
      ...new Set([
        ...errorsInBChanges.map(e => e.file),
        ...errorsInAChanges.map(e => e.file),
        ...sharedErrorFiles,
      ]),
    ]

    const parts: string[] = []
    if (errorsInBChanges.length > 0) {
      parts.push(
        `${resultA.branchName} has type errors in files modified by ${resultB.branchName}`,
      )
    }
    if (errorsInAChanges.length > 0) {
      parts.push(
        `${resultB.branchName} has type errors in files modified by ${resultA.branchName}`,
      )
    }
    if (sharedErrorFiles.length > 0 && parts.length === 0) {
      parts.push(`both branches have errors in the same files`)
    }

    return {
      branchA: resultA.branchName,
      branchB: resultB.branchName,
      description: parts.join('; '),
      filesInvolved,
    }
  }
}

/** Default exec implementation using Node's child_process */
export function createDefaultExec(): ExecFn {
  return async (command: string, cwd: string): Promise<ExecResult> => {
    const { exec } = await import('child_process')
    return new Promise(resolve => {
      exec(command, { cwd }, (_error, stdout, stderr) => {
        resolve({ stdout: stdout || '', stderr: stderr || '', exitCode: 0 })
      })
    })
  }
}

export function createSemanticConflictDetector(tsconfigPath?: string): SemanticConflictDetector {
  return new SemanticConflictDetector(createDefaultExec(), tsconfigPath)
}
