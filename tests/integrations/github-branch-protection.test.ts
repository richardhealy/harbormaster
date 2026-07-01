import { describe, it, expect, vi } from 'vitest'
import { enforceBranchProtection } from '../../src/integrations/github/branch-protection'
import type { OctokitLike } from '../../src/integrations/github/branch-protection'

describe('enforceBranchProtection', () => {
  it('calls the branch protection endpoint with sane defaults', async () => {
    const octokit: OctokitLike = { request: vi.fn().mockResolvedValue({ data: {} }) }

    await enforceBranchProtection(octokit, 'acme', 'myapp', 'main')

    expect(octokit.request).toHaveBeenCalledWith(
      'PUT /repos/{owner}/{repo}/branches/{branch}/protection',
      expect.objectContaining({
        owner: 'acme',
        repo: 'myapp',
        branch: 'main',
        required_status_checks: { strict: true, contexts: [] },
        enforce_admins: true,
        required_pull_request_reviews: { required_approving_review_count: 1 },
        restrictions: null,
      }),
    )
  })

  it('passes through required status check contexts', async () => {
    const octokit: OctokitLike = { request: vi.fn().mockResolvedValue({ data: {} }) }

    await enforceBranchProtection(octokit, 'acme', 'myapp', 'main', {
      requiredStatusChecks: ['ci', 'lint'],
    })

    expect(octokit.request).toHaveBeenCalledWith(
      'PUT /repos/{owner}/{repo}/branches/{branch}/protection',
      expect.objectContaining({
        required_status_checks: { strict: true, contexts: ['ci', 'lint'] },
      }),
    )
  })

  it('honours overrides for strictness, review count, and admin enforcement', async () => {
    const octokit: OctokitLike = { request: vi.fn().mockResolvedValue({ data: {} }) }

    await enforceBranchProtection(octokit, 'acme', 'myapp', 'release/1.0', {
      requireStrictStatusChecks: false,
      requiredApprovingReviewCount: 2,
      enforceAdmins: false,
    })

    expect(octokit.request).toHaveBeenCalledWith(
      'PUT /repos/{owner}/{repo}/branches/{branch}/protection',
      expect.objectContaining({
        branch: 'release/1.0',
        required_status_checks: { strict: false, contexts: [] },
        required_pull_request_reviews: { required_approving_review_count: 2 },
        enforce_admins: false,
      }),
    )
  })

  it('propagates errors from the GitHub API instead of swallowing them', async () => {
    const octokit: OctokitLike = {
      request: vi.fn().mockRejectedValue(new Error('403 Forbidden — missing admin permission')),
    }

    await expect(enforceBranchProtection(octokit, 'acme', 'myapp', 'main')).rejects.toThrow(
      '403 Forbidden',
    )
  })
})
