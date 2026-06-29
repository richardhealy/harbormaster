import type { BranchConfig, FeatureBranchName, FeatureType } from './types.js'
import { formatBranchVersion } from './semver.js'
import { DEFAULT_BRANCH_CONFIG } from './types.js'

export interface BranchPlan {
  name: string
  baseBranch: string
  type: 'release' | 'hotfix' | 'feature'
}

export function releaseBranchName(
  version: string,
  cfg: BranchConfig = DEFAULT_BRANCH_CONFIG,
): string {
  return `${cfg.releaseBranchPrefix}${formatBranchVersion(version)}`
}

export function hotfixBranchName(
  version: string,
  cfg: BranchConfig = DEFAULT_BRANCH_CONFIG,
): string {
  return `${cfg.hotfixBranchPrefix}${version}`
}

export function featureBranchName(f: FeatureBranchName): string {
  const slugPart = f.slug ? `-${f.slug}` : ''
  return `${f.type}/${f.ticketId}${slugPart}`
}

// Ticket IDs follow the pattern TEAM-NUMBER (e.g. ENG-123, PROJ-42).
// The slug is everything after the ticket ID and its trailing dash.
const TICKET_ID_RE = /^([A-Z]+-\d+)(?:-(.+))?$/

export function parseFeatureBranch(
  branchName: string,
): FeatureBranchName | null {
  const TYPES: FeatureType[] = [
    'feat',
    'fix',
    'chore',
    'docs',
    'refactor',
    'test',
    'perf',
    'ci',
  ]
  for (const type of TYPES) {
    if (!branchName.startsWith(`${type}/`)) continue
    const rest = branchName.slice(type.length + 1)
    const match = TICKET_ID_RE.exec(rest)
    if (match) {
      return { type, ticketId: match[1] ?? rest, slug: match[2] ?? '' }
    }
    // Fallback for ticket IDs without the standard format
    return { type, ticketId: rest, slug: '' }
  }
  return null
}

export function planReleaseBranch(
  version: string,
  cfg: BranchConfig = DEFAULT_BRANCH_CONFIG,
): BranchPlan {
  return {
    name: releaseBranchName(version, cfg),
    baseBranch: cfg.mainBranch,
    type: 'release',
  }
}

export function planHotfixBranch(
  version: string,
  cfg: BranchConfig = DEFAULT_BRANCH_CONFIG,
): BranchPlan {
  return {
    name: hotfixBranchName(version, cfg),
    baseBranch: cfg.mainBranch,
    type: 'hotfix',
  }
}

export function isReleaseBranch(
  branchName: string,
  cfg: BranchConfig = DEFAULT_BRANCH_CONFIG,
): boolean {
  return branchName.startsWith(cfg.releaseBranchPrefix)
}

export function isHotfixBranch(
  branchName: string,
  cfg: BranchConfig = DEFAULT_BRANCH_CONFIG,
): boolean {
  return branchName.startsWith(cfg.hotfixBranchPrefix)
}

export function extractVersionFromReleaseBranch(
  branchName: string,
  cfg: BranchConfig = DEFAULT_BRANCH_CONFIG,
): string | null {
  if (!isReleaseBranch(branchName, cfg)) return null
  return branchName.slice(cfg.releaseBranchPrefix.length)
}
