export interface ImpactEstimateInput {
  ticketId: string
  title: string
  description?: string
  labels?: string[]
  /** Explicitly declared files this ticket is expected to change */
  expectedFiles?: string[]
}

export interface ImpactSurface {
  ticketId: string
  /** File paths this ticket is expected to affect */
  files: string[]
  /** Top-level directories derived from `files` */
  directories: string[]
  /** Named domains / modules (e.g. 'release', 'integration/worktrees') */
  domains: string[]
  /**
   * Confidence in this estimate: 1.0 when derived from explicit file lists,
   * lower when inferred from labels or keywords.
   */
  confidence: number
}

/** Mapping from domain keyword to canonical domain name */
export type DomainMap = Record<string, string>

export const DEFAULT_DOMAIN_MAP: DomainMap = {
  release: 'release',
  branch: 'release',
  tag: 'release',
  hotfix: 'release',
  semver: 'release',
  worktree: 'integration/worktrees',
  queue: 'integration/queue',
  merge: 'integration/queue',
  rerun: 'integration/rerun',
  rebase: 'integration/rerun',
  ci: 'integration/rerun',
  scheduler: 'scheduler',
  impact: 'impact',
  dispatch: 'scheduler',
  gate: 'gates',
  scope: 'gates',
  hitl: 'gates',
  approval: 'gates',
  linear: 'integrations/linear',
  github: 'integrations/github',
  webhook: 'integrations/github',
  provenance: 'provenance',
  audit: 'provenance',
  db: 'db',
  migration: 'db',
  schema: 'db',
  hotspot: 'hotspots',
  lease: 'hotspots',
  lock: 'hotspots',
  semantic: 'integration/semantic',
  typecheck: 'integration/semantic',
  agent: 'agent-iface',
  cli: 'agent-iface/cli',
  mcp: 'agent-iface/mcp',
}
