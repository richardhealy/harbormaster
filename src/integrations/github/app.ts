import { App } from "@octokit/app";
import type { Octokit } from "@octokit/core";

export interface GitHubAppConfig {
  appId: string | number;
  privateKey: string;
  webhookSecret: string;
}

export interface GitHubApp {
  app: App;
  getInstallationOctokit(installationId: number): Promise<Octokit>;
}

/**
 * Creates a GitHub App instance from the given config.
 * All agent→GitHub interactions (branch creation, PR management, status checks)
 * go through this authenticated app client.
 */
export function createGitHubApp(config: GitHubAppConfig): GitHubApp {
  const app = new App({
    appId: config.appId,
    privateKey: config.privateKey,
    webhooks: {
      secret: config.webhookSecret,
    },
  });

  return {
    app,
    async getInstallationOctokit(installationId: number) {
      return app.getInstallationOctokit(installationId);
    },
  };
}

/**
 * Reads GitHub App credentials from environment variables.
 * Throws if any required variable is missing.
 */
export function appConfigFromEnv(): GitHubAppConfig {
  const appId = process.env["GITHUB_APP_ID"];
  const privateKey = process.env["GITHUB_APP_PRIVATE_KEY"];
  const webhookSecret = process.env["GITHUB_WEBHOOK_SECRET"];

  if (!appId || !privateKey || !webhookSecret) {
    throw new Error(
      "Missing required GitHub App environment variables: GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET"
    );
  }

  return { appId, privateKey, webhookSecret };
}
