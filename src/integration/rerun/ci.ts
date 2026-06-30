import type { CheckRunSummary, CIResult, CIStatus } from './types'

export type { CheckRunSummary, CIResult, CIStatus }

/** Minimal Octokit-like interface so the checker can be tested without live credentials */
export interface OctokitLike {
  request<T = unknown>(route: string, params?: Record<string, unknown>): Promise<{ data: T }>
}

interface GitHubCheckRun {
  name: string
  status: 'queued' | 'in_progress' | 'completed'
  conclusion: string | null
}

interface CheckRunsResponse {
  check_runs: GitHubCheckRun[]
}

const PASSING_CONCLUSIONS = new Set(['success', 'neutral', 'skipped'])

/**
 * Queries GitHub check runs for a given ref and maps the aggregate result to
 * one of four statuses: 'success', 'failure', 'pending', or 'unknown' (no
 * check runs configured).
 */
export class CIChecker {
  constructor(
    private readonly octokit: OctokitLike,
    private readonly owner: string,
    private readonly repo: string,
  ) {}

  async checkStatus(ref: string): Promise<CIResult> {
    const { data } = await this.octokit.request<CheckRunsResponse>(
      'GET /repos/{owner}/{repo}/commits/{ref}/check-runs',
      { owner: this.owner, repo: this.repo, ref },
    )

    const checkRuns: CheckRunSummary[] = data.check_runs.map(cr => ({
      name: cr.name,
      status: cr.status,
      conclusion: cr.conclusion,
    }))

    const status = aggregate(checkRuns)
    return { status, checkRuns }
  }
}

function aggregate(checkRuns: CheckRunSummary[]): CIStatus {
  if (checkRuns.length === 0) return 'unknown'

  for (const cr of checkRuns) {
    if (cr.status === 'completed' && cr.conclusion !== null && !PASSING_CONCLUSIONS.has(cr.conclusion)) {
      return 'failure'
    }
  }

  if (checkRuns.some(cr => cr.status !== 'completed')) return 'pending'

  return 'success'
}
