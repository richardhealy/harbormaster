import type { App } from '@octokit/app'
import { enforceBranchProtection, type OctokitLike } from './branch-protection'

export interface RegisterWebhooksOptions {
  /** Branch to protect and to watch for direct pushes. Defaults to `'main'`. */
  protectedBranch?: string
  /** Status check contexts required on the protected branch. Defaults to none. */
  requiredStatusChecks?: string[]
  /** Injectable for tests; defaults to the real {@link enforceBranchProtection}. */
  protectRepo?: (
    octokit: OctokitLike,
    owner: string,
    repo: string,
    branch: string,
    options: { requiredStatusChecks: string[] },
  ) => Promise<void>
}

/**
 * Registers the webhook handlers that back the spec's "no direct main
 * pushes and required checks" guarantee, plus basic merge/CI observability.
 *
 * The actual enforcement happens once, automatically, whenever the App
 * gains access to a repo (`installation.created` / `installation_repositories.added`):
 * it configures branch protection on `protectedBranch` via the GitHub API,
 * so GitHub itself refuses direct pushes and requires the named checks.
 * The `push` handler below only logs a push that already happened — it
 * can't undo it — so protection has to be a standing repo setting, not a
 * reactive check.
 */
export function registerWebhooks(app: App, options: RegisterWebhooksOptions = {}): void {
  const {
    protectedBranch = 'main',
    requiredStatusChecks = [],
    protectRepo = enforceBranchProtection,
  } = options

  app.webhooks.on('push', async ({ payload }) => {
    if (payload.ref === `refs/heads/${protectedBranch}`) {
      console.warn(`[github] Direct push to ${protectedBranch} detected from ${payload.pusher.name}`)
    }
  })

  app.webhooks.on('pull_request.closed', async ({ payload }) => {
    if (payload.pull_request.merged) {
      console.log(`[github] PR #${payload.pull_request.number} merged into ${payload.pull_request.base.ref}`)
    }
  })

  app.webhooks.on('check_suite.completed', async ({ payload }) => {
    console.log(
      `[github] Check suite ${payload.check_suite.conclusion ?? 'pending'} ` +
        `on ${payload.repository.full_name}`,
    )
  })

  app.webhooks.on('installation.created', async ({ payload, octokit }) => {
    for (const repo of payload.repositories ?? []) {
      await protectOne(octokit, repo.full_name)
    }
  })

  app.webhooks.on('installation_repositories.added', async ({ payload, octokit }) => {
    for (const repo of payload.repositories_added) {
      await protectOne(octokit, repo.full_name)
    }
  })

  async function protectOne(octokit: OctokitLike, fullName: string): Promise<void> {
    const [owner, repo] = fullName.split('/')
    try {
      await protectRepo(octokit, owner, repo, protectedBranch, { requiredStatusChecks })
      console.log(`[github] protected ${protectedBranch} on ${fullName}`)
    } catch (err) {
      console.warn(`[github] failed to protect ${protectedBranch} on ${fullName}: ${(err as Error).message}`)
    }
  }
}
