import type { App } from '@octokit/app'

/**
 * Wires the webhook handlers backing the spec's "no direct main pushes"
 * requirement and queue observability. These currently log; the GitHub
 * branch-protection rule does the actual enforcement, and check-suite /
 * PR-merge events are the hook point for driving the provenance recorder
 * and queue status updates once those are wired in here.
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
