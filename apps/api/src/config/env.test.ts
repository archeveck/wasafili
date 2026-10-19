import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

const valid = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'x'.repeat(32),
};

describe('parseEnv', () => {
  it('applique les valeurs par défaut', () => {
    expect(parseEnv(valid)).toMatchObject({
      API_PORT: 3000,
      ACCESS_TOKEN_TTL: 900,
      CORS_ORIGINS: [],
    });
  });

  it('découpe la liste des origines CORS', () => {
    expect(
      parseEnv({ ...valid, CORS_ORIGINS: 'http://a.test, http://b.test,' }).CORS_ORIGINS,
    ).toEqual(['http://a.test', 'http://b.test']);
  });

  it('refuse un secret JWT trop court', () => {
    expect(() => parseEnv({ ...valid, JWT_SECRET: 'court' })).toThrow(/JWT_SECRET/);
  });

  it('traite un jeton de métriques vide comme absent, refuse un jeton trop court', () => {
    expect(parseEnv({ ...valid, METRICS_TOKEN: '' }).METRICS_TOKEN).toBeUndefined();
    expect(() => parseEnv({ ...valid, METRICS_TOKEN: 'court' })).toThrow(/METRICS_TOKEN/);
  });
});
