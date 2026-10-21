import { describe, expect, it } from 'vitest';
import { passwordSchema } from '../auth/password-policy';
import { parseBootstrapEnv } from './bootstrap';

const env = {
  BOOTSTRAP_INSTANCE_SHORT: 'sodeci',
  BOOTSTRAP_INSTANCE_NAME: 'SODECI Abidjan',
  BOOTSTRAP_ADMIN_EMAIL: 'admin@sodeci.ci',
  BOOTSTRAP_ADMIN_FIRST_NAME: 'Awa',
  BOOTSTRAP_ADMIN_LAST_NAME: 'Koné',
};

describe("amorçage d'une installation", () => {
  it('crée une instance et un seul administrateur', () => {
    const { input, generatedPassword } = parseBootstrapEnv({
      ...env,
      BOOTSTRAP_ADMIN_PASSWORD: 'gazelle-baobab-lagune',
    });
    expect(generatedPassword).toBe(false);
    expect(input).toEqual({
      short: 'sodeci',
      name: 'SODECI Abidjan',
      users: [
        {
          email: 'admin@sodeci.ci',
          password: 'gazelle-baobab-lagune',
          firstName: 'Awa',
          lastName: 'Koné',
          role: 'admin',
        },
      ],
    });
  });

  it('tire un mot de passe conforme à la politique quand aucun n’est fourni', () => {
    const first = parseBootstrapEnv(env);
    const second = parseBootstrapEnv(env);
    expect(first.generatedPassword).toBe(true);
    expect(passwordSchema.safeParse(first.input.users[0]!.password).success).toBe(true);
    expect(first.input.users[0]!.password).not.toBe(second.input.users[0]!.password);
  });

  it('refuse un mot de passe faible, un identifiant réservé ou des variables manquantes', () => {
    expect(() => parseBootstrapEnv({ ...env, BOOTSTRAP_ADMIN_PASSWORD: 'Wasafili' })).toThrow(
      /BOOTSTRAP_ADMIN_PASSWORD/,
    );
    expect(() => parseBootstrapEnv({ ...env, BOOTSTRAP_INSTANCE_SHORT: 'oauth' })).toThrow(
      /identifiant réservé/,
    );
    expect(() => parseBootstrapEnv({ ...env, BOOTSTRAP_INSTANCE_SHORT: 'Mon Instance' })).toThrow(
      /BOOTSTRAP_INSTANCE_SHORT/,
    );
    expect(() => parseBootstrapEnv({})).toThrow(/BOOTSTRAP_ADMIN_EMAIL/);
  });
});
