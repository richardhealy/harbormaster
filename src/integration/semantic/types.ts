export interface BranchInput {
  branchName: string
  worktreePath: string
  /** Repo-relative file paths modified by this branch */
  changedFiles: string[]
}

export interface TypeScriptError {
  file: string
  line: number
  column: number
  /** TypeScript error code, e.g. "TS2345" */
  code: string
  message: string
  severity: 'error' | 'warning'
}

export interface BranchCheckResult {
  branchName: string
  /** True when tsc produced no errors or warnings */
  clean: boolean
  errors: TypeScriptError[]
  durationMs: number
}

export interface CrossBranchConflict {
  branchA: string
  branchB: string
  /** Human-readable description of why this is a conflict */
  description: string
  /** Files involved in the detected semantic conflict */
  filesInvolved: string[]
}

export interface SemanticConflictReport {
  branchResults: BranchCheckResult[]
  crossBranchConflicts: CrossBranchConflict[]
  /** True when any branch has errors or any cross-branch conflict was found */
  hasConflicts: boolean
}

export interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

/** Injectable command executor — keeps SemanticConflictDetector testable */
export type ExecFn = (command: string, cwd: string) => Promise<ExecResult>
