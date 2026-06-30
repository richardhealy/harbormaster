/** Estimated impact of a ticket on the codebase */
export interface ImpactSurface {
  ticketId: string;
  /** Files this ticket directly plans to modify */
  directFiles: string[];
  /** All files reachable from directFiles via the reverse dependency graph */
  transitiveFiles: string[];
}

/** A node in the file-level dependency graph */
export interface DependencyNode {
  path: string;
  /** Files this file imports (absolute, normalised paths; local only) */
  imports: string[];
  /** Files that import this file */
  importedBy: string[];
}

/** Full dependency graph: normalised absolute file path → node */
export type DependencyGraph = Map<string, DependencyNode>;

/** Overlap between two impact surfaces */
export interface OverlapAnalysis {
  ticketA: string;
  ticketB: string;
  /** Files present in both transitive impact surfaces */
  overlappingFiles: string[];
  /**
   * Fraction of the smaller surface that is shared (0–1).
   * 0 = no overlap, 1 = one surface is a complete subset of the other.
   */
  overlapRatio: number;
}
