import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { loadEnv } from './env.js';

/** File unique pour l'instant ; les files dédiées (pdf, mail, webhooks) arrivent en Phase 5. */
export const QUEUE_NAME = 'tesserax';

const env = loadEnv();
const logger = pino({ level: env.LOG_LEVEL, base: { service: 'worker' } });
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    logger.warn({ jobId: job.id, name: job.name }, 'aucun traitement enregistré pour ce job');
  },
  { connection },
);

worker.on('ready', () => logger.info({ queue: QUEUE_NAME }, 'worker prêt'));
worker.on('failed', (job, err) => logger.error({ jobId: job?.id, err }, 'job en échec'));

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'arrêt du worker');
  await worker.close();
  await connection.quit();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
