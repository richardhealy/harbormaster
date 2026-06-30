export type {
  ImpactSurface,
  DependencyNode,
  DependencyGraph,
  OverlapAnalysis,
} from './types'

export {
  buildDependencyGraph,
  collectFiles,
  extractImports,
  resolveImport,
} from './graph'

export { computeTransitiveImpact, analyseOverlap } from './estimator'
