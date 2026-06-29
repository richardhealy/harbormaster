import dotenv from 'dotenv';

dotenv.config();

export interface Config {
  port: number;
  nodeEnv: string;
  database: {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
    url?: string;
  };
  github: {
    appId: string;
    privateKey: string;
    webhookSecret: string;
    clientId: string;
    clientSecret: string;
  };
  linear: {
    apiKey: string;
    webhookSecret: string;
  };
  mergeQueue: {
    provider: 'github' | 'mergify';
    mergifyApiKey?: string;
  };
}

function required(key: string): string {
  const val = process.env[key];
  if (!val) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return val;
}

function optional(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}

export function loadConfig(): Config {
  return {
    port: parseInt(optional('PORT', '3000'), 10),
    nodeEnv: optional('NODE_ENV', 'development'),
    database: {
      host: optional('DB_HOST', 'localhost'),
      port: parseInt(optional('DB_PORT', '5432'), 10),
      name: optional('DB_NAME', 'harbormaster'),
      user: optional('DB_USER', 'postgres'),
      password: optional('DB_PASSWORD', ''),
      url: process.env['DATABASE_URL'],
    },
    github: {
      appId: optional('GITHUB_APP_ID'),
      privateKey: optional('GITHUB_PRIVATE_KEY', '').replace(/\\n/g, '\n'),
      webhookSecret: optional('GITHUB_WEBHOOK_SECRET'),
      clientId: optional('GITHUB_CLIENT_ID'),
      clientSecret: optional('GITHUB_CLIENT_SECRET'),
    },
    linear: {
      apiKey: optional('LINEAR_API_KEY'),
      webhookSecret: optional('LINEAR_WEBHOOK_SECRET'),
    },
    mergeQueue: {
      provider: (optional('MERGE_QUEUE_PROVIDER', 'github') as 'github' | 'mergify'),
      mergifyApiKey: process.env['MERGIFY_API_KEY'],
    },
  };
}

export const config = loadConfig();
export { required };
