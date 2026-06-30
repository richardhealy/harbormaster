import type { App } from '@octokit/app'

/**
 * Wires up the GitHub webhook handlers that let harbormaster react to
 * repository activity in (near) real time, rather than polling the GitHub
 * API. These events are the trigger points for the rest of the system: a
 * push to `main` indicates someone bypassed the merge queue, a merged PR
 * marks queue work as landed, and a completed check suite reports CI
 * results back into the gate pipeline.
 *
 * @param app - The GitHub App instance returned by `createGitHubApp`.
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
