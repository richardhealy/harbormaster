/** Risk classification for a domain; drives default gate requirements. */
export type RiskLevel = 'low' | 'medium' | 'high'

/** The four sequential gate stages every change may pass through. */
export type GateStage = 'scope' | 'ci' | 'qa' | 'hitl'

/**
 * Outcome of a single gate evaluation.
 * - `passed`            — stage cleared; does not block merge.
 * - `failed`            — stage rejected the change; blocks merge.
 * - `skipped`           — policy does not require this stage; does not block merge.
 * - `awaiting`          — stage is required but not yet decidable (e.g. CI still running,
 *                         HITL approval not yet received); blocks merge until re-evaluated.
 */
export type GateOutcome = 'passed' | 'failed' | 'skipped' | 'awaiting'

/**
 * Per-domain gate policy.  Register policies via `GatePipeline.registerPolicy`.
 * Unknown domains fall back to `DEFAULT_DOMAIN_POLICY`.
 */
export interface DomainPolicy {
  /** Domain name matching `ImpactSurface.domains` entries (e.g. `'db'`, `'release'`). */
  domain: string
  /** Determines the default posture for this domain. */
  risk: RiskLevel
  /**
   * When true, the scope stage checks that actual changed files do not drift
   * too far from the estimated impact surface.
   */
  requireScope: boolean
  /**
   * Maximum ratio of unexpected files to total actual files before the scope
   * gate fails.  0 = zero tolerance; 1 = any drift is acceptable.
   * Default: 0.5 (flag when more than half the files were unexpected).
   */
  scopeDriftThreshold: number
  /** CI must be green on the rebased tip before merge is allowed. */
  requireCI: boolean
  /** An automated QA check must pass (e.g. eval, integration test, sign-off). */
  requireQA: boolean
  /**
   * A human must approve before merge.  When false the change auto-merges once
   * all other required gates pass.  High-risk domains (migrations, contracts)
   * should always set this to true.
   */
  requireHITL: boolean
}

/** Result of the scope-drift calculation. */
export interface ScopeCheckResult {
  passed: boolean
  /** Ratio of unexpected files to total actual files (0–1). */
  driftRatio: number
  /** Files that appeared in `actualFiles` but not in `expectedFiles`. */
  unexpectedFiles: string[]
  reason: string
}

/** Decision record for one gate stage. */
export interface GateDecision {
  stage: GateStage
  outcome: GateOutcome
  reason: string
  /** When the decision was recorded. */
  at: Date
  /** Identity of the approver (HITL gate only). */
  by?: string
}

/** Full result of running the gate pipeline for one dispatch. */
export interface GateResult {
  dispatchId: string
  ticketId: string
  domain: string
  policy: DomainPolicy
  decisions: GateDecision[]
  /** True only when all required stages passed and no stage is awaiting. */
  canMerge: boolean
  /** Stage that is currently blocking merge (failed or awaiting). */
  blockedAt?: GateStage
}

// ---------------------------------------------------------------------------
// Injectable function types
// ---------------------------------------------------------------------------

/** Injectable clock — allows deterministic tests. */
export type ClockFn = () => Date

/**
 * Returns the CI status for a given ref.
 * Mirror of `CIChecker.checkStatus` in `src/integration/rerun/ci.ts`.
 */
export type CIStatusFn = (ref: string) => Promise<'success' | 'failure' | 'pending' | 'unknown'>

/** Runs automated QA checks for a dispatch. */
export type QACheckFn = (dispatchId: string) => Promise<{ passed: boolean; reason: string }>

/** Requests or polls a human approval for a dispatch / ticket. */
export type HITLApprovalFn = (
  dispatchId: string,
  ticketId: string,
) => Promise<{ approved: boolean; by: string; reason?: string }>

/** All inputs required to run the full pipeline for one dispatch. */
export interface GateRunOptions {
  dispatchId: string
  ticketId: string
  /** Domain key used to look up the policy (e.g. `'db'`, `'release'`). */
  domain: string
  // --- scope stage ---
  /** Files the impact estimator predicted would change. */
  expectedFiles: string[]
  /** Files that actually changed (e.g. from `git diff --name-only`). */
  actualFiles: string[]
  // --- CI stage ---
  /** The commit ref (SHA or branch) to check CI results against. */
  headRef: string
  /** Injectable CI status resolver; required when `policy.requireCI` is true. */
  ciStatus?: CIStatusFn
  // --- QA stage ---
  /** Injectable QA check; required when `policy.requireQA` is true. */
  qaCheck?: QACheckFn
  // --- HITL stage ---
  /** Injectable HITL resolver; when absent and HITL is required the gate is `awaiting`. */
  hitlApproval?: HITLApprovalFn
}

/** Default policy applied to domains that have no explicit registration. */
export const DEFAULT_DOMAIN_POLICY: Omit<DomainPolicy, 'domain'> = {
  risk: 'medium',
  requireScope: true,
  scopeDriftThreshold: 0.5,
  requireCI: true,
  requireQA: false,
  requireHITL: false,
}

/** Well-known domain policies shipped with harbormaster. */
export const BUILTIN_POLICIES: DomainPolicy[] = [
  {
    domain: 'db',
    risk: 'high',
    requireScope: true,
    scopeDriftThreshold: 0.2,
    requireCI: true,
    requireQA: true,
    requireHITL: true,
  },
  {
    domain: 'release',
    risk: 'high',
    requireScope: true,
    scopeDriftThreshold: 0.3,
    requireCI: true,
    requireQA: false,
    requireHITL: true,
  },
  {
    domain: 'hotspots',
    risk: 'high',
    requireScope: true,
    scopeDriftThreshold: 0.2,
    requireCI: true,
    requireQA: false,
    requireHITL: true,
  },
  {
    domain: 'docs',
    risk: 'low',
    requireScope: false,
    scopeDriftThreshold: 1.0,
    requireCI: true,
    requireQA: false,
    requireHITL: false,
  },
  {
    domain: 'integration/queue',
    risk: 'medium',
    requireScope: true,
    scopeDriftThreshold: 0.5,
    requireCI: true,
    requireQA: false,
    requireHITL: false,
  },
]
