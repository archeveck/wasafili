import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  /** Préfixe Redis des files de jobs (isole les environnements qui partagent un Redis). */
  QUEUE_PREFIX: z.string().min(1).default('tesserax'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET doit contenir au moins 32 caractères'),
  ACCESS_TOKEN_TTL: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 30),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  LOGIN_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(20),
  /** Stockage S3 (MinIO) des fichiers. Absent : endpoints fichiers indisponibles (503). */
  S3_ENDPOINT: z.url().optional(),
  /** Adresse du stockage vue des clients (URL signées) ; par défaut S3_ENDPOINT. */
  S3_PUBLIC_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('tesserax'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  /** Taille maximale d'un fichier téléversé (octets). */
  MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(25 * 1024 * 1024),
  /** Relais des notifications en push Expo (D1) ; les notifications restent dans la sync. */
  PUSH_ENABLED: z.stringbool().default(false),
  /** Conversion DOCX → PDF des rapports (Gotenberg). Absent : rapports indisponibles (503). */
  GOTENBERG_URL: z.url().optional(),
  /** Délai maximal d'une conversion PDF (ms). */
  GOTENBERG_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  /** Adresse publique du back-office (liens dans les e-mails). */
  APP_URL: z.url().default('http://localhost:5173'),
  /** Nombre de proxies de confiance devant l'API (Traefik = 1) : sert à lire l'IP cliente. */
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Configuration invalide :\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

/** Jeton d'injection de la configuration validée. */
export const ENV = Symbol('ENV');
