import * as dotenv from 'dotenv';

dotenv.config();

export interface Config {
  github: {
    appId: string;
    privateKey: string;
    webhookSecret: string;
    installationId?: string;
  };
  database: {
    url: string;
  };
  server: {
    port: number;
  };
  release: {
    mainBranch: string;
    developBranch: string;
    releaseBranchPrefix: string;
    hotfixBranchPrefix: string;
  };
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export function loadConfig(): Config {
  return {
    github: {
      appId: optional('GITHUB_APP_ID', ''),
      privateKey: optional('GITHUB_PRIVATE_KEY', '').replace(/\\n/g, '\n'),
      webhookSecret: optional('GITHUB_WEBHOOK_SECRET', ''),
      installationId: process.env['GITHUB_INSTALLATION_ID'],
    },
    database: {
      url: optional('DATABASE_URL', 'postgresql://localhost:5432/harbormaster'),
    },
    server: {
      port: parseInt(optional('PORT', '3000'), 10),
    },
    release: {
      mainBranch: optional('MAIN_BRANCH', 'main'),
      developBranch: optional('DEVELOP_BRANCH', 'develop'),
      releaseBranchPrefix: optional('RELEASE_BRANCH_PREFIX', 'release/'),
      hotfixBranchPrefix: optional('HOTFIX_BRANCH_PREFIX', 'hotfix/'),
    },
  };
}

let _config: Config | undefined;

export function getConfig(): Config {
  if (!_config) _config = loadConfig();
  return _config;
}

export function resetConfig(): void {
  _config = undefined;
}
