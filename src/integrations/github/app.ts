import * as crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

export type WebhookEventType =
  | 'push'
  | 'pull_request'
  | 'check_run'
  | 'check_suite'
  | 'merge_group'
  | string;

export interface WebhookEvent {
  type: WebhookEventType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: Record<string, any>;
}

export type WebhookHandler = (event: WebhookEvent) => Promise<void>;

/**
 * Verify the HMAC-SHA256 signature GitHub sends with every webhook delivery.
 * Returns true if the signature matches; false if tampered or missing.
 */
export function verifyWebhookSignature(
  payload: string | Buffer,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature) return false;

  const expected = `sha256=${crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')}`;

  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Express middleware: verifies the GitHub webhook signature and rejects
 * requests that fail validation with 401.
 */
export function webhookSignatureMiddleware(secret: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const sig = req.headers['x-hub-signature-256'] as string | undefined;
    const raw = (req as Request & { rawBody?: Buffer }).rawBody ?? JSON.stringify(req.body);

    if (!verifyWebhookSignature(raw, sig, secret)) {
      res.status(401).json({ error: 'Invalid webhook signature' });
      return;
    }
    next();
  };
}

/**
 * Minimal GitHub App webhook dispatcher. Maps event type strings to handlers
 * and calls them sequentially when a webhook arrives.
 */
export class GitHubAppWebhooks {
  private handlers: Map<string, WebhookHandler[]> = new Map();

  on(eventType: WebhookEventType, handler: WebhookHandler): this {
    const list = this.handlers.get(eventType) ?? [];
    list.push(handler);
    this.handlers.set(eventType, list);
    return this;
  }

  async dispatch(event: WebhookEvent): Promise<void> {
    const handlers = this.handlers.get(event.type) ?? [];
    for (const handler of handlers) {
      await handler(event);
    }
  }

  /**
   * Express route handler for POST /webhooks/github
   */
  expressHandler() {
    return async (req: Request, res: Response): Promise<void> => {
      const eventType = req.headers['x-github-event'] as string;
      const payload = req.body as Record<string, unknown>;

      try {
        await this.dispatch({ type: eventType, payload });
        res.status(200).json({ ok: true });
      } catch (err) {
        console.error('Webhook handler error:', err);
        res.status(500).json({ error: 'Internal error' });
      }
    };
  }
}

/**
 * Handler: enforce that no one pushes directly to the main branch.
 * To be registered as: webhooks.on('push', enforceNoDirectMainPush(...))
 */
export function enforceNoDirectMainPush(
  mainBranch: string,
  onViolation: (pusher: string, sha: string) => Promise<void>,
): WebhookHandler {
  return async (event) => {
    if (event.type !== 'push') return;
    const ref: string = event.payload['ref'] ?? '';
    if (ref !== `refs/heads/${mainBranch}`) return;

    const pusher: string = event.payload['pusher']?.['name'] ?? 'unknown';
    const sha: string = event.payload['after'] ?? '';

    // GitHub App protects the branch via branch protection rules; this handler
    // provides a secondary notification / audit trail.
    await onViolation(pusher, sha);
  };
}
