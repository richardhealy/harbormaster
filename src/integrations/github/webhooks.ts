import type { App } from '@octokit/app'

/**
 * Registers the webhook handlers that back the spec's "no direct main
 * pushes" guarantee and basic merge/CI observability. These currently log;
 * a production deployment would route the push-to-main case into a
 * provenance event or a branch-protection enforcement action instead.
 */
export function registerWebhooks(app: App): void {
  // Enforce no direct pushes to main — agents must go through the queue
  app.webhooks.on('push', async ({ payload }) => {
    if (payload.ref === 'refs/heads/main') {
      console.warn(`[github] Direct push to main detected from ${payload.pusher.name}`)
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
}
