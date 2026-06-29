import { Octokit } from '@octokit/rest';
import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../../config';

export interface WebhookEvent {
  event: string;
  payload: Record<string, unknown>;
  signature: string;
  rawBody: string;
}

export function verifyWebhookSignature(event: WebhookEvent): boolean {
  const secret = process.env['GITHUB_WEBHOOK_SECRET'] ?? config.github.webhookSecret;
  if (!secret) return true;

  const expected = createHmac('sha256', secret)
    .update(event.rawBody)
    .digest('hex');

  const expectedBuf = Buffer.from(`sha256=${expected}`);
  const signatureBuf = Buffer.from(event.signature);

  if (expectedBuf.length !== signatureBuf.length) return false;
  return timingSafeEqual(expectedBuf, signatureBuf);
}

export function createOctokit(installationToken: string): Octokit {
  return new Octokit({ auth: installationToken });
}

export interface PushProtectionConfig {
  owner: string;
  repo: string;
  defaultBranch: string;
  requiredChecks: string[];
}

export function handlePushEvent(payload: Record<string, unknown>): {
  ref: string;
  isMainBranch: boolean;
  blocked: boolean;
  reason?: string;
} {
  const ref = (payload['ref'] as string) ?? '';
  const branch = ref.replace('refs/heads/', '');
  const defaultBranch = (payload['repository'] as Record<string, unknown>)?.['default_branch'] as string ?? 'main';

  const isMainBranch = branch === defaultBranch;

  if (isMainBranch) {
    return {
      ref,
      isMainBranch: true,
      blocked: true,
      reason: 'Direct pushes to the default branch are not permitted. Use the agent dispatch workflow.',
    };
  }

  return { ref, isMainBranch: false, blocked: false };
}

export interface CheckRunOptions {
  owner: string;
  repo: string;
  name: string;
  headSha: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion?: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required';
  title: string;
  summary: string;
}

export async function createCheckRun(
  octokit: Octokit,
  opts: CheckRunOptions
): Promise<{ id: number }> {
  const { data } = await octokit.checks.create({
    owner: opts.owner,
    repo: opts.repo,
    name: opts.name,
    head_sha: opts.headSha,
    status: opts.status,
    conclusion: opts.conclusion,
    output: {
      title: opts.title,
      summary: opts.summary,
    },
  });
  return { id: data.id };
}
