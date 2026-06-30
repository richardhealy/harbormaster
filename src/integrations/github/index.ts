import { App } from '@octokit/app'

/**
 * Builds the Octokit `App` instance from `GITHUB_APP_ID`,
 * `GITHUB_APP_PRIVATE_KEY`, and `GITHUB_WEBHOOK_SECRET`. Returns `null` when
 * any of those are unset, so the control-plane can run with GitHub
 * integration disabled (e.g. local dev) instead of failing to boot.
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
