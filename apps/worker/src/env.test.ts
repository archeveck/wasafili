import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const valid = {
  REDIS_URL: 'redis://localhost:6379',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY: 'k',
  S3_SECRET_KEY: 's',
};

describe('loadEnv', () => {
  it('accepte une configuration valide et applique les défauts', () => {
    expect(loadEnv(valid)).toMatchObject({
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      S3_BUCKET: 'wasafili',
    });
  });

  it('refuse une configuration incomplète avec un message explicite', () => {
    expect(() => loadEnv({ REDIS_URL: valid.REDIS_URL })).toThrow(/DATABASE_URL/);
  });
});
