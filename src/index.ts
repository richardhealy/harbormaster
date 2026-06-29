import { config } from './config';
import { createApp } from './server';

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`harbormaster listening on port ${config.port} [${config.nodeEnv}]`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received — shutting down');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('SIGINT received — shutting down');
  server.close(() => process.exit(0));
});
