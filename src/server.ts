import express from 'express';
import { getConfig } from './config';
import { GitHubAppWebhooks, webhookSignatureMiddleware } from './integrations/github/app';

export function createServer(webhooks: GitHubAppWebhooks) {
  const config = getConfig();
  const app = express();

  // Capture raw body for signature verification before JSON parse
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'harbormaster' });
  });

  if (config.github.webhookSecret) {
    app.use('/webhooks/github', webhookSignatureMiddleware(config.github.webhookSecret));
  }

  app.post('/webhooks/github', webhooks.expressHandler());

  return app;
}
