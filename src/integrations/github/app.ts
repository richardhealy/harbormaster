import { App } from '@octokit/app';

export interface GitHubAppConfig {
  appId: number | string;
  privateKey: string;
  webhookSecret: string;
  clientId: string;
  clientSecret: string;
}

export function createGitHubApp(config: GitHubAppConfig): App {
  return new App({
    appId: config.appId,
    privateKey: config.privateKey,
    webhooks: {
      secret: config.webhookSecret,
    },
    oauth: {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    },
  });
}

export function githubAppConfigFromEnv(): GitHubAppConfig {
  const keys = ['GITHUB_APP_ID', 'GITHUB_PRIVATE_KEY', 'GITHUB_WEBHOOK_SECRET', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'] as const;
  const env: Record<string, string> = {};
  for (const key of keys) {
    const val = process.env[key];
    if (!val) throw new Error(`Missing required env var: ${key}`);
    env[key] = val;
  }
  return {
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_PRIVATE_KEY,
    webhookSecret: env.GITHUB_WEBHOOK_SECRET,
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
  };
}
