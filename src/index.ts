import { getConfig } from './config';
import { GitHubAppWebhooks, enforceNoDirectMainPush } from './integrations/github/app';
import { createServer } from './server';

async function main() {
  const config = getConfig();
  const webhooks = new GitHubAppWebhooks();

  webhooks.on(
    'push',
    enforceNoDirectMainPush(config.release.mainBranch, async (pusher, sha) => {
      console.warn(`Direct push to ${config.release.mainBranch} detected: pusher=${pusher} sha=${sha}`);
    }),
  );

  const server = createServer(webhooks);

  server.listen(config.server.port, () => {
    console.log(`harbormaster listening on port ${config.server.port}`);
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
