import { App } from '@octokit/app';
import { Webhooks } from '@octokit/webhooks';

export interface GitHubAppConfig {
  appId: string;
  privateKey: string;
  webhookSecret: string;
  clientId?: string;
  clientSecret?: string;
}

export class HarbormasterGitHubApp {
  private app: App;
  webhooks: Webhooks;

  constructor(config: GitHubAppConfig) {
    this.app = new App({
      appId: config.appId,
      privateKey: config.privateKey,
      webhooks: { secret: config.webhookSecret },
      oauth: config.clientId
        ? { clientId: config.clientId, clientSecret: config.clientSecret ?? '' }
        : undefined,
    });
    this.webhooks = new Webhooks({ secret: config.webhookSecret });
    this.registerHandlers();
  }

  private registerHandlers() {
    this.webhooks.on('push', async ({ payload }) => {
      const ref = payload.ref;
      if (ref === 'refs/heads/main') {
        console.log(`[github-app] push to main from ${payload.repository.full_name}`);
      }
    });

    this.webhooks.on('pull_request.opened', async ({ payload }) => {
      console.log(`[github-app] PR opened: #${payload.pull_request.number} in ${payload.repository.full_name}`);
    });

    this.webhooks.on('pull_request.synchronize', async ({ payload }) => {
      console.log(`[github-app] PR updated: #${payload.pull_request.number}`);
    });

    this.webhooks.on('check_suite.completed', async ({ payload }) => {
      console.log(`[github-app] check_suite completed: ${payload.check_suite.conclusion}`);
    });
  }

  async getInstallationOctokit(installationId: number) {
    return this.app.getInstallationOctokit(installationId);
  }

  async verifyAndReceive(opts: { id: string; name: string; signature: string; payload: string }) {
    return this.webhooks.verifyAndReceive(opts);
  }
}

export function createGitHubApp(config: GitHubAppConfig): HarbormasterGitHubApp {
  return new HarbormasterGitHubApp(config);
}
