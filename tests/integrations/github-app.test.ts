import * as crypto from 'crypto';
import {
  verifyWebhookSignature,
  GitHubAppWebhooks,
  enforceNoDirectMainPush,
  WebhookEvent,
} from '../../src/integrations/github/app';

describe('verifyWebhookSignature', () => {
  const secret = 'my-webhook-secret';

  function sign(payload: string): string {
    return `sha256=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;
  }

  it('returns true for a valid signature', () => {
    const payload = JSON.stringify({ action: 'opened' });
    expect(verifyWebhookSignature(payload, sign(payload), secret)).toBe(true);
  });

  it('returns false for an invalid signature', () => {
    const payload = JSON.stringify({ action: 'opened' });
    expect(verifyWebhookSignature(payload, 'sha256=invalidsig', secret)).toBe(false);
  });

  it('returns false when signature is missing', () => {
    expect(verifyWebhookSignature('payload', undefined, secret)).toBe(false);
  });

  it('returns false when payload was tampered', () => {
    const payload = JSON.stringify({ action: 'opened' });
    const sig = sign(payload);
    expect(verifyWebhookSignature(payload + 'tampered', sig, secret)).toBe(false);
  });
});

describe('GitHubAppWebhooks', () => {
  it('dispatches to registered handlers', async () => {
    const webhooks = new GitHubAppWebhooks();
    const received: WebhookEvent[] = [];

    webhooks.on('push', async event => { received.push(event); });

    await webhooks.dispatch({ type: 'push', payload: { ref: 'refs/heads/main' } });

    expect(received).toHaveLength(1);
    expect(received[0]!.type).toBe('push');
  });

  it('ignores events with no registered handlers', async () => {
    const webhooks = new GitHubAppWebhooks();
    await expect(webhooks.dispatch({ type: 'unknown', payload: {} })).resolves.not.toThrow();
  });

  it('calls multiple handlers for the same event', async () => {
    const webhooks = new GitHubAppWebhooks();
    const calls: number[] = [];

    webhooks.on('push', async () => { calls.push(1); });
    webhooks.on('push', async () => { calls.push(2); });

    await webhooks.dispatch({ type: 'push', payload: {} });
    expect(calls).toEqual([1, 2]);
  });
});

describe('enforceNoDirectMainPush', () => {
  it('calls onViolation for a push to main', async () => {
    const violations: Array<{ pusher: string; sha: string }> = [];
    const handler = enforceNoDirectMainPush('main', async (pusher, sha) => {
      violations.push({ pusher, sha });
    });

    await handler({
      type: 'push',
      payload: { ref: 'refs/heads/main', pusher: { name: 'alice' }, after: 'abc123' },
    });

    expect(violations).toHaveLength(1);
    expect(violations[0]).toEqual({ pusher: 'alice', sha: 'abc123' });
  });

  it('does not call onViolation for a push to a feature branch', async () => {
    const violations: unknown[] = [];
    const handler = enforceNoDirectMainPush('main', async () => { violations.push(1); });

    await handler({
      type: 'push',
      payload: { ref: 'refs/heads/feature/my-feature', pusher: { name: 'bob' }, after: 'def456' },
    });

    expect(violations).toHaveLength(0);
  });

  it('does not call onViolation for a non-push event', async () => {
    const violations: unknown[] = [];
    const handler = enforceNoDirectMainPush('main', async () => { violations.push(1); });

    await handler({ type: 'pull_request', payload: { action: 'opened' } });
    expect(violations).toHaveLength(0);
  });
});
