import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { passwordSchema } from '../auth/password-policy';
import { type SeedInstanceInput } from './seed-instance';

/** Segments de `/v1/…` pris par les routes hors instance : un identifiant court ne peut pas les porter. */
const RESERVED_SHORTS = new Set([
  'apps',
  'docs',
  'health',
  'me',
  'metrics',
  'oauth',
  'openapi.json',
  'password-reset',
]);

const bootstrapEnvSchema = z.object({
  BOOTSTRAP_INSTANCE_SHORT: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,39}$/, 'minuscules, chiffres et tirets (2 à 40 caractères)')
    .refine((short) => !RESERVED_SHORTS.has(short), 'identifiant réservé'),
  BOOTSTRAP_INSTANCE_NAME: z.string().trim().min(1).max(200),
  BOOTSTRAP_ADMIN_EMAIL: z.email(),
  BOOTSTRAP_ADMIN_FIRST_NAME: z.string().trim().min(1).max(100),
  BOOTSTRAP_ADMIN_LAST_NAME: z.string().trim().min(1).max(100),
  BOOTSTRAP_ADMIN_PASSWORD: passwordSchema.optional(),
});

export interface BootstrapPlan {
  input: SeedInstanceInput;
  /** Vrai si le mot de passe a été tiré au hasard (à communiquer une fois à l'administrateur). */
  generatedPassword: boolean;
}

/**
 * Lit la première instance et son administrateur dans l'environnement (`BOOTSTRAP_*`). Sans
 * `BOOTSTRAP_ADMIN_PASSWORD`, un mot de passe aléatoire est tiré.
 */
export function parseBootstrapEnv(env: Record<string, string | undefined>): BootstrapPlan {
  const result = bootstrapEnvSchema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues.map(
      (issue) => `  ${issue.path.join('.')} : ${issue.message}`,
    );
    throw new Error(`Variables d'amorçage invalides :\n${details.join('\n')}`);
  }
  const vars = result.data;
  const password = vars.BOOTSTRAP_ADMIN_PASSWORD ?? randomBytes(18).toString('base64url');
  return {
    generatedPassword: vars.BOOTSTRAP_ADMIN_PASSWORD === undefined,
    input: {
      short: vars.BOOTSTRAP_INSTANCE_SHORT,
      name: vars.BOOTSTRAP_INSTANCE_NAME,
      users: [
        {
          email: vars.BOOTSTRAP_ADMIN_EMAIL,
          password,
          firstName: vars.BOOTSTRAP_ADMIN_FIRST_NAME,
          lastName: vars.BOOTSTRAP_ADMIN_LAST_NAME,
          role: 'admin',
        },
      ],
    },
  };
}
