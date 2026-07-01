/** Minimal Octokit-like interface so protection can be configured without a real GitHub connection in tests. */
export interface OctokitLike {
  request<T = unknown>(
    route: string,
    params?: Record<string, unknown>,
  ): Promise<{ data: T }>
}

export interface BranchProtectionOptions {
  /** Status check contexts that must pass before merge (e.g. `['ci']`). Empty means none required beyond the PR itself. */
  requiredStatusChecks?: string[]
  /** Require the branch to be up to date with the base before a status check counts. Defaults to `true`. */
  requireStrictStatusChecks?: boolean
  /** Approving reviews required on the PR. Defaults to `1`. */
  requiredApprovingReviewCount?: number
  /** Apply the rules to repo admins too, not just everyone else. Defaults to `true`. */
  enforceAdmins?: boolean
}

/**
 * Configures GitHub branch protection on `branch` so it rejects direct
 * pushes and requires the named status checks before merge.
 *
 * This is what actually backs the spec's "no direct main pushes and
 * required checks" guarantee. The push webhook handler only observes a
 * push after it already happened; GitHub itself has to be the one that
 * refuses it, which is what branch protection rules do at the git level.
 */
export async function enforceBranchProtection(
  octokit: OctokitLike,
  owner: string,
  repo: string,
  branch: string,
  options: BranchProtectionOptions = {},
): Promise<void> {
  const {
    requiredStatusChecks = [],
    requireStrictStatusChecks = true,
    requiredApprovingReviewCount = 1,
    enforceAdmins = true,
  } = options

  await octokit.request('PUT /repos/{owner}/{repo}/branches/{branch}/protection', {
    owner,
    repo,
    branch,
    required_status_checks: {
      strict: requireStrictStatusChecks,
      contexts: requiredStatusChecks,
    },
    enforce_admins: enforceAdmins,
    required_pull_request_reviews: {
      required_approving_review_count: requiredApprovingReviewCount,
    },
    restrictions: null,
  })
}
