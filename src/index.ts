import 'dotenv/config';
import { loadConfig } from './config';
import { logger } from './logger';

const config = loadConfig();

logger.info('harbormaster starting', {
  env: config.NODE_ENV,
  port: config.PORT,
  mergeQueueProvider: config.MERGE_QUEUE_PROVIDER,
});
