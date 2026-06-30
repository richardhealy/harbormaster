import { App } from '@octokit/app'

/**
 * Builds the GitHub App client from `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY`
 * / `GITHUB_WEBHOOK_SECRET`. Returns `null` instead of throwing when any of
 * those are unset, so the control plane can boot with the GitHub integration
 * disabled (e.g. in local dev or CI).
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
