import express, { Request, Response, NextFunction } from 'express';
import { handlePushEvent, verifyWebhookSignature } from './integrations/github/app';

export function createApp() {
  const app = express();

  app.use(express.json({ limit: '10mb' }));

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'harbormaster' });
  });

  app.post('/webhooks/github', express.raw({ type: '*/*' }), (req: Request, res: Response) => {
    const signature = req.headers['x-hub-signature-256'] as string;
    const event = req.headers['x-github-event'] as string;
    const rawBody = req.body as Buffer;

    if (!verifyWebhookSignature({
      event,
      payload: {},
      signature,
      rawBody: rawBody.toString('utf8'),
    })) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      res.status(400).json({ error: 'Invalid JSON' });
      return;
    }

    if (event === 'push') {
      const result = handlePushEvent(payload);
      if (result.blocked) {
        res.status(403).json({ error: result.reason });
        return;
      }
    }

    res.json({ received: true, event });
  });

  app.post('/webhooks/linear', express.raw({ type: '*/*' }), (_req: Request, res: Response) => {
    res.json({ received: true });
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
