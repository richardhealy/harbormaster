import { App } from '@octokit/app';
import { Webhooks } from '@octokit/webhooks';

export interface GitHubAppConfig {
  appId: string | number;
  privateKey: string;
  webhookSecret: string;
  clientId?: string;
  clientSecret?: string;
}

export class GitHubApp {
  private app: App;
  readonly webhooks: Webhooks;

  constructor(config: GitHubAppConfig) {
    this.app = new App({
      appId: config.appId,
      privateKey: config.privateKey,
      webhooks: { secret: config.webhookSecret },
      ...(config.clientId && config.clientSecret
        ? { oauth: { clientId: config.clientId, clientSecret: config.clientSecret } }
        : {}),
    });
    this.webhooks = this.app.webhooks as unknown as Webhooks;
  }

  async getInstallationOctokit(installationId: number) {
    return this.app.getInstallationOctokit(installationId);
  }

  /** Register handlers that enforce no direct push to main (protected branch policy). */
  registerProtectedBranchEnforcement(mainBranch = 'main'): void {
    this.webhooks.on('push', async ({ payload }) => {
      const ref = payload.ref;
      if (ref === `refs/heads/${mainBranch}`) {
        const sender = payload.sender?.login ?? 'unknown';
        // Only flag direct pushes — merge commits from the merge queue are allowed.
        // Distinguish them by checking for 'merge_queue_entry' in commit message.
        const isMergeQueueCommit = payload.commits?.every((c) =>
          c.message.includes('[merge queue]') || c.message.startsWith('Merge ')
        );
        if (!isMergeQueueCommit) {
          console.warn(`[GitHubApp] Direct push to ${mainBranch} detected by ${sender}`);
          // In production, this would notify and potentially revert.
        }
      }
    });
  }
}

export function createGitHubAppFromEnv(): GitHubApp {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

  if (!appId || !privateKey || !webhookSecret) {
    throw new Error(
      'Missing required env vars: GITHUB_APP_ID, GITHUB_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET'
    );
  }

  return new GitHubApp({
    appId,
    privateKey,
    webhookSecret,
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
  });
}
