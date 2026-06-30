import type { ScopeCheckResult } from './types'

/**
 * Stage 1 of the gate pipeline: flags a diff that touched substantially
 * more (or different) files than the impact estimator predicted, since
 * large drift from the predicted surface is a signal the change went
 * beyond its intended scope.
 */
export class ScopeChecker {
  /**
   * Compares the actual diff files against the predicted impact surface.
   *
   * When no files were predicted (empty expectedFiles), the check is
   * bypassed and always passes — a confidence-0 estimate can't constrain
   * scope.
   *
   * driftRatio = unexpectedFiles.length / expectedFiles.length.
   * A ratio above `driftThreshold` fails the gate.
   */
  check(expectedFiles: string[], actualFiles: string[], driftThreshold: number): ScopeCheckResult {
    const expectedSet = new Set(expectedFiles)
    const unexpectedFiles = actualFiles.filter(f => !expectedSet.has(f))

    if (expectedFiles.length === 0) {
      return { passed: true, expectedFiles, actualFiles, unexpectedFiles, driftRatio: 0 }
    }

    const driftRatio = unexpectedFiles.length / expectedFiles.length

    if (driftRatio > driftThreshold) {
      const sample = unexpectedFiles.slice(0, 3).join(', ')
      const ellipsis = unexpectedFiles.length > 3 ? '…' : ''
      return {
        passed: false,
        expectedFiles,
        actualFiles,
        unexpectedFiles,
        driftRatio,
        reason: `Scope drift ${(driftRatio * 100).toFixed(0)}% exceeds threshold ${(driftThreshold * 100).toFixed(0)}% (${unexpectedFiles.length} unexpected file(s): ${sample}${ellipsis})`,
      }
    }

    return { passed: true, expectedFiles, actualFiles, unexpectedFiles, driftRatio }
  }
}
