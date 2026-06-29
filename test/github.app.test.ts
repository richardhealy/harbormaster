import { verifyWebhookSignature, handlePushEvent } from '../src/integrations/github/app';
import { createHmac } from 'crypto';

describe('verifyWebhookSignature', () => {
  const secret = 'test-secret';
  const body = '{"action":"push"}';

  function makeSignature(b: string, s: string): string {
    const sig = createHmac('sha256', s).update(b).digest('hex');
    return `sha256=${sig}`;
  }

  it('returns true for valid signature', () => {
    const sig = makeSignature(body, secret);
    process.env['GITHUB_WEBHOOK_SECRET'] = secret;
    const result = verifyWebhookSignature({
      event: 'push',
      payload: {},
      signature: sig,
      rawBody: body,
    });
    expect(result).toBe(true);
    delete process.env['GITHUB_WEBHOOK_SECRET'];
  });

  it('returns false for invalid signature', () => {
    process.env['GITHUB_WEBHOOK_SECRET'] = secret;
    const result = verifyWebhookSignature({
      event: 'push',
      payload: {},
      signature: 'sha256=invalid',
      rawBody: body,
    });
    expect(result).toBe(false);
    delete process.env['GITHUB_WEBHOOK_SECRET'];
  });

  it('returns true when no webhook secret is configured', () => {
    delete process.env['GITHUB_WEBHOOK_SECRET'];
    const result = verifyWebhookSignature({
      event: 'push',
      payload: {},
      signature: 'sha256=anything',
      rawBody: body,
    });
    expect(result).toBe(true);
  });
});

describe('handlePushEvent', () => {
  function makePayload(ref: string, defaultBranch = 'main') {
    return {
      ref,
      repository: { default_branch: defaultBranch },
    };
  }

  it('blocks direct push to main', () => {
    const result = handlePushEvent(makePayload('refs/heads/main'));
    expect(result.blocked).toBe(true);
    expect(result.isMainBranch).toBe(true);
    expect(result.reason).toContain('not permitted');
  });

  it('allows push to feature branch', () => {
    const result = handlePushEvent(makePayload('refs/heads/feat/ENG-123-my-feature'));
    expect(result.blocked).toBe(false);
    expect(result.isMainBranch).toBe(false);
  });

  it('blocks push to custom default branch', () => {
    const result = handlePushEvent(makePayload('refs/heads/master', 'master'));
    expect(result.blocked).toBe(true);
  });
});
