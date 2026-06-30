import { App } from '@octokit/app'

/**
 * Builds the GitHub App client harbormaster uses to enforce "no direct main
 * pushes and required checks" and to receive the webhook events that drive
 * queue and gate-pipeline updates (see `registerWebhooks`).
 *
 * Returns `null` instead of throwing when the required env vars
 * (`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`) are
 * missing, so callers can treat the GitHub integration as optional/disabled
 * (e.g. in local dev or tests) rather than crashing on startup.
 */
export function createGitHubApp(): App | null {
  const { GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET } = process.env

  if (!GITHUB_APP_ID || !GITHUB_APP_PRIVATE_KEY || !GITHUB_WEBHOOK_SECRET) {
    return null
  }

  return new App({
    appId: GITHUB_APP_ID,
    privateKey: GITHUB_APP_PRIVATE_KEY,
    webhooks: {
      secret: GITHUB_WEBHOOK_SECRET,
    },
  })
}
