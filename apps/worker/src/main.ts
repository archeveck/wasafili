import { S3Client } from '@aws-sdk/client-s3';
import { AUTOMATION_QUEUE_NAME, type JobName, type JobPayloads, QUEUE_NAME } from '@wasafili/jobs';
import { type Job, Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import nodemailer from 'nodemailer';
import pg from 'pg';
import { pino } from 'pino';
import { loadEnv } from './env.js';
import { processAccountEmail, processEmail } from './email.js';
import { startOpsServer, workerMetrics } from './ops.js';
import { cleanupPhotoExports, processPhotoExport } from './photo-export.js';
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
  'account-email': (payload) => processAccountEmail(payload, { mailer, from: env.MAIL_FROM }),
  webhook: async (payload, job) => {
    await processWebhook(payload, {
      db,
      send: sendWebhook,
      disableAfter: env.WEBHOOK_DISABLE_AFTER,
      final: isFinal(job),
    });
  },
  'photos-zip': async (payload, job) => {
    await processPhotoExport(payload, { s3, bucket: env.S3_BUCKET, db, final: isFinal(job) });
  },
  'photo-exports-cleanup': async () => {
    const removed = await cleanupPhotoExports({ s3, bucket: env.S3_BUCKET, db });
    if (removed > 0) logger.info({ removed }, 'archives de photos expirées supprimées');
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

// Purge des archives de photos expirées, toutes les 6 heures (idempotent au redémarrage).
const scheduler = new Queue(QUEUE_NAME, { connection, prefix: env.QUEUE_PREFIX });
void scheduler
  .upsertJobScheduler(
    'photo-exports-cleanup',
    { every: 6 * 3600 * 1000 },
    { name: 'photo-exports-cleanup', data: {}, opts: { removeOnComplete: 10, removeOnFail: 50 } },
  )
  .catch((err: unknown) => logger.error({ err }, 'planification de la purge des exports'));

// Exploitation : santé et métriques (files du worker et des automatisations de l'API).
const automations = new Queue(AUTOMATION_QUEUE_NAME, { connection, prefix: env.QUEUE_PREFIX });
const metrics = workerMetrics([scheduler, automations]);
const ops = startOpsServer({
  port: env.WORKER_OPS_PORT,
  registry: metrics.registry,
  checks: { redis: () => connection.ping(), database: () => db.query('SELECT 1') },
});

worker.on('ready', () => logger.info({ queue: QUEUE_NAME }, 'worker prêt'));
worker.on('completed', (job) => {
  metrics.record(job, 'completed');
  logger.info({ jobId: job.id, name: job.name }, 'job terminé');
});
worker.on('failed', (job, err) => {
  metrics.record(job, 'failed');
  logger.error({ jobId: job?.id, name: job?.name, err }, 'job en échec');
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'arrêt du worker');
  ops.close();
  await worker.close();
  await Promise.all([scheduler.close(), automations.close()]);
  await Promise.all([connection.quit(), db.end()]);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
