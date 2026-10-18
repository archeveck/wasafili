import { S3Client } from '@aws-sdk/client-s3';
import { type JobName, type JobPayloads, QUEUE_NAME } from '@tesserax/jobs';
import { type Job, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import nodemailer from 'nodemailer';
import pg from 'pg';
import { pino } from 'pino';
import { loadEnv } from './env.js';
import { processEmail } from './email.js';
import { processPush } from './push.js';
import { processThumbnail } from './thumbnail.js';
import { httpSender, processWebhook } from './webhook.js';

const env = loadEnv();
const logger = pino({ level: env.LOG_LEVEL, base: { service: 'worker' } });
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const db = new pg.Pool({ connectionString: env.DATABASE_URL, max: 5 });
const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: true,
  credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
});

const mailer = env.SMTP_URL ? nodemailer.createTransport(env.SMTP_URL) : undefined;
const sendWebhook = httpSender(env.WEBHOOK_ALLOW_PRIVATE);

type Handlers = { [N in JobName]: (payload: JobPayloads[N], job: Job) => Promise<void> };

/** Dernière tentative du job : un échec devient définitif. */
const isFinal = (job: Job) => job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

const handlers: Handlers = {
  thumbnail: (payload) => processThumbnail(payload, { s3, bucket: env.S3_BUCKET, db }),
  push: async (payload) => {
    const { sent } = await processPush(payload, {
      db,
      fetch,
      url: env.EXPO_PUSH_URL,
      ...(env.EXPO_ACCESS_TOKEN ? { accessToken: env.EXPO_ACCESS_TOKEN } : {}),
    });
    logger.info({ sent }, 'push envoyés');
  },
  email: async (payload, job) => {
    await processEmail(payload, {
      db,
      s3,
      bucket: env.S3_BUCKET,
      mailer,
      from: env.MAIL_FROM,
      final: isFinal(job),
    });
  },
  webhook: async (payload, job) => {
    await processWebhook(payload, {
      db,
      send: sendWebhook,
      disableAfter: env.WEBHOOK_DISABLE_AFTER,
      final: isFinal(job),
    });
  },
};

const worker = new Worker(
  QUEUE_NAME,
  async (job: Job) => {
    const handler = handlers[job.name as JobName];
    if (!handler) throw new Error(`Job inconnu : ${job.name}`);
    await handler(job.data, job);
  },
  { connection, concurrency: 4, prefix: env.QUEUE_PREFIX },
);

worker.on('ready', () => logger.info({ queue: QUEUE_NAME }, 'worker prêt'));
worker.on('completed', (job) => logger.info({ jobId: job.id, name: job.name }, 'job terminé'));
worker.on('failed', (job, err) =>
  logger.error({ jobId: job?.id, name: job?.name, err }, 'job en échec'),
);

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'arrêt du worker');
  await worker.close();
  await Promise.all([connection.quit(), db.end()]);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
