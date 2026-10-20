import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  REDIS_URL: z.url(),
  QUEUE_PREFIX: z.string().min(1).default('wasafili'),
  /** Rôle applicatif (RLS) : le worker pose le contexte d'instance de chaque job. */
  DATABASE_URL: z.url(),
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('wasafili'),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  /** Service Expo Push (remplaçable par un relais) et jeton d'accès facultatif. */
  EXPO_PUSH_URL: z.url().default('https://exp.host/--/api/v2/push/send'),
  EXPO_ACCESS_TOKEN: z.string().min(1).optional(),
  /** Relais SMTP (D5), ex. `smtp://localhost:1025` (Mailpit). Absent : e-mails en échec expliqué. */
  SMTP_URL: z.url().optional(),
  MAIL_FROM: z.string().min(3).default('Wasafili <no-reply@wasafili.local>'),
  /** Webhooks vers des adresses privées (réseau interne, n8n local) : désactivé = garde SSRF. */
  WEBHOOK_ALLOW_PRIVATE: z.stringbool().default(false),
  /** Livraisons échouées d'affilée avant désactivation d'un webhook. */
  WEBHOOK_DISABLE_AFTER: z.coerce.number().int().min(1).default(5),
  /** Port interne de `/health` et `/metrics` (P7.2.2). */
  WORKER_OPS_PORT: z.coerce.number().int().positive().default(3002),
});

export type WorkerEnv = z.infer<typeof envSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): WorkerEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Configuration invalide :\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
