import type { DomainPolicy, RiskLevel } from './types'

/**
 * Fallback policy used when a change touches no domain in {@link POLICY_TABLE}.
 * Defaults to medium risk (CI + QA, no HITL) rather than the most lenient or
 * strictest option, since an unrecognized domain is an unknown quantity.
 */
export const DEFAULT_POLICY: DomainPolicy = {
  domain: 'default',
  riskLevel: 'medium',
  scopeDriftThreshold: 0.5,
  requiresQA: true,
  requiresHITL: false,
}

const POLICY_TABLE: DomainPolicy[] = [
  // Low risk — auto-merge on green CI, no QA or HITL required
  { domain: 'docs', riskLevel: 'low', scopeDriftThreshold: 2.0, requiresQA: false, requiresHITL: false },
  { domain: 'readme', riskLevel: 'low', scopeDriftThreshold: 2.0, requiresQA: false, requiresHITL: false },

  // Medium risk — CI + QA required, no human approval
  { domain: 'release', riskLevel: 'medium', scopeDriftThreshold: 0.5, requiresQA: true, requiresHITL: false },
  { domain: 'integration/worktrees', riskLevel: 'medium', scopeDriftThreshold: 0.5, requiresQA: true, requiresHITL: false },
  { domain: 'integration/queue', riskLevel: 'medium', scopeDriftThreshold: 0.5, requiresQA: true, requiresHITL: false },
  { domain: 'integration/rerun', riskLevel: 'medium', scopeDriftThreshold: 0.5, requiresQA: true, requiresHITL: false },
  { domain: 'integration/semantic', riskLevel: 'medium', scopeDriftThreshold: 0.5, requiresQA: true, requiresHITL: false },
  { domain: 'scheduler', riskLevel: 'medium', scopeDriftThreshold: 0.5, requiresQA: true, requiresHITL: false },
  { domain: 'impact', riskLevel: 'medium', scopeDriftThreshold: 0.5, requiresQA: true, requiresHITL: false },
  { domain: 'gates', riskLevel: 'medium', scopeDriftThreshold: 0.5, requiresQA: true, requiresHITL: false },
  { domain: 'agent-iface', riskLevel: 'medium', scopeDriftThreshold: 0.5, requiresQA: true, requiresHITL: false },
  { domain: 'agent-iface/cli', riskLevel: 'medium', scopeDriftThreshold: 0.5, requiresQA: true, requiresHITL: false },
  { domain: 'agent-iface/mcp', riskLevel: 'medium', scopeDriftThreshold: 0.5, requiresQA: true, requiresHITL: false },
  { domain: 'integrations/github', riskLevel: 'medium', scopeDriftThreshold: 0.5, requiresQA: true, requiresHITL: false },
  { domain: 'integrations/linear', riskLevel: 'medium', scopeDriftThreshold: 0.5, requiresQA: true, requiresHITL: false },

  // High risk — CI + QA + HITL, tight scope threshold
  { domain: 'db', riskLevel: 'high', scopeDriftThreshold: 0.2, requiresQA: true, requiresHITL: true },
  { domain: 'hotspots', riskLevel: 'high', scopeDriftThreshold: 0.2, requiresQA: true, requiresHITL: true },
  { domain: 'provenance', riskLevel: 'high', scopeDriftThreshold: 0.2, requiresQA: true, requiresHITL: true },
]

const POLICY_MAP = new Map<string, DomainPolicy>(POLICY_TABLE.map(p => [p.domain, p]))

const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 }

/**
 * Resolves the strictest policy that applies to any of the given domains.
 * A change touching both a low-risk domain (e.g. docs) and a high-risk one
 * (e.g. db) must be gated as high-risk — the riskiest domain it touches
 * determines the scrutiny it gets, not the average or the first match.
 * When none of the domains is recognised, DEFAULT_POLICY (medium risk) is
 * returned; unknown domains within a mixed list are ignored.
 */
export function resolvePolicy(domains: string[]): DomainPolicy {
  const matches = domains
    .map(d => POLICY_MAP.get(d))
    .filter((p): p is DomainPolicy => p !== undefined)

  if (matches.length === 0) return DEFAULT_POLICY

  return matches.reduce((strictest, candidate) =>
    RISK_ORDER[candidate.riskLevel] > RISK_ORDER[strictest.riskLevel] ? candidate : strictest,
  )
}
