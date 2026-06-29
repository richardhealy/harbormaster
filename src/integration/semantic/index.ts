export interface SemanticConflict {
  branch: string;
  conflictingBranch: string;
  affectedSymbol: string;
  location: string;
  description: string;
}

export interface SemanticCheckResult {
  passed: boolean;
  conflicts: SemanticConflict[];
}
