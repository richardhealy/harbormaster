import { App } from '@octokit/app';
import { Webhooks } from '@octokit/webhooks';
import { logger } from '../../logger';

export interface GitHubAppConfig {
  appId: string;
  privateKey: string;
  webhookSecret: string;
  clientId?: string;
  clientSecret?: string;
}

export function createGitHubApp(config: GitHubAppConfig): App {
  return new App({
    appId: config.appId,
    privateKey: config.privateKey,
    webhooks: {
      secret: config.webhookSecret,
    },
    oauth: config.clientId && config.clientSecret
      ? { clientId: config.clientId, clientSecret: config.clientSecret }
      : undefined,
  });
}

export function configFromEnv(): GitHubAppConfig {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_PRIVATE_KEY;
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

  if (!appId || !privateKey || !webhookSecret) {
    throw new Error(
      'Missing required GitHub App env vars: GITHUB_APP_ID, GITHUB_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET',
    );
  }

  return {
    appId,
    privateKey: privateKey.replace(/\\n/g, '\n'),
    webhookSecret,
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
  };
}

export function registerWebhookHandlers(webhooks: Webhooks): void {
  webhooks.on('push', ({ payload }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = payload as any;
    logger.info('GitHub push event', {
      repo: p.repository?.full_name,
      ref: p.ref,
      commits: p.commits?.length ?? 0,
    });
  });

  webhooks.on('pull_request.opened', ({ payload }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = payload as any;
    logger.info('Pull request opened', {
      repo: p.repository?.full_name,
      number: p.pull_request?.number,
      title: p.pull_request?.title,
    });
  });

  webhooks.on('pull_request.closed', ({ payload }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = payload as any;
    if (p.pull_request?.merged) {
      logger.info('Pull request merged', {
        repo: p.repository?.full_name,
        number: p.pull_request?.number,
      });
    }
  });

  webhooks.on('check_run.completed', ({ payload }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = payload as any;
    logger.info('Check run completed', {
      repo: p.repository?.full_name,
      name: p.check_run?.name,
      conclusion: p.check_run?.conclusion,
    });
  });
}
