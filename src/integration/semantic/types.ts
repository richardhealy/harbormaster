/** A single in-flight branch to typecheck, along with the files it touches. */
export interface BranchInput {
  branchName: string
  worktreePath: string
  /** Repo-relative file paths modified by this branch */
  changedFiles: string[]
}

/** A single diagnostic line parsed from `tsc --noEmit` output. */
export interface TypeScriptError {
  file: string
  line: number
  column: number
  /** TypeScript error code, e.g. "TS2345" */
  code: string
  message: string
  severity: 'error' | 'warning'
}

/** Result of typechecking a single branch's worktree. */
export interface BranchCheckResult {
  branchName: string
  /** True when tsc produced no errors or warnings */
  clean: boolean
  errors: TypeScriptError[]
  durationMs: number
}

/**
 * A semantic conflict detected between two branches — their changes typecheck
 * incompatibly when considered together, even if each branch alone is clean.
 */
export interface CrossBranchConflict {
  branchA: string
  branchB: string
  /** Human-readable description of why this is a conflict */
  description: string
  /** Files involved in the detected semantic conflict */
  filesInvolved: string[]
}

/** Aggregate result of running semantic conflict detection across a set of branches. */
export interface SemanticConflictReport {
  branchResults: BranchCheckResult[]
  crossBranchConflicts: CrossBranchConflict[]
  /** True when any branch has errors or any cross-branch conflict was found */
  hasConflicts: boolean
}

/** Output of an executed shell command. */
export interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

/** Injectable command executor — keeps SemanticConflictDetector testable */
export type ExecFn = (command: string, cwd: string) => Promise<ExecResult>
