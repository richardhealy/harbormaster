import 'dotenv/config';
import express from 'express';
import { createGitHubAppFromEnv } from './integrations/github';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

async function main(): Promise<void> {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: process.env.npm_package_version ?? '0.1.0' });
  });

  // GitHub App webhook endpoint
  if (process.env.GITHUB_APP_ID) {
    try {
      const githubApp = createGitHubAppFromEnv();
      githubApp.registerProtectedBranchEnforcement();

      app.post('/webhooks/github', async (req, res) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (githubApp.webhooks as any).receive({
            id: req.headers['x-github-delivery'] as string,
            name: req.headers['x-github-event'] as string,
            payload: req.body,
          });
          res.status(200).send('ok');
        } catch (err) {
          console.error('Webhook error:', err);
          res.status(500).send('error');
        }
      });
    } catch (err) {
      console.warn('GitHub App not configured — webhook endpoint disabled:', (err as Error).message);
    }
  }

  app.listen(PORT, () => {
    console.log(`harbormaster control-plane listening on :${PORT}`);
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
