import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';

export interface GitHubClientOptions {
  appId: string;
  privateKey: string;
  installationId: string;
}

/**
 * Create an Octokit client authenticated as a GitHub App installation.
 */
export function createInstallationClient(opts: GitHubClientOptions): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: opts.appId,
      privateKey: opts.privateKey,
      installationId: opts.installationId,
    },
  });
}

/**
 * Create an unauthenticated client (for public endpoints / testing).
 */
export function createPublicClient(): Octokit {
  return new Octokit();
}

export type { Octokit };
