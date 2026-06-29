import { App } from '@octokit/app'

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
