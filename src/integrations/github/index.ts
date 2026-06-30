import { App } from '@octokit/app'

/**
 * Builds the GitHub App client from `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` /
 * `GITHUB_WEBHOOK_SECRET`. Returns `null` rather than throwing when any are
 * missing, so the service can boot with GitHub integration disabled (e.g. local
 * dev) instead of crashing on startup.
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
