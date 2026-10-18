import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

describe('loadEnv', () => {
  it('accepte une configuration valide et applique les défauts', () => {
    expect(loadEnv({ REDIS_URL: 'redis://localhost:6379' })).toMatchObject({
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
    });
  });

  it('refuse une configuration incomplète avec un message explicite', () => {
    expect(() => loadEnv({})).toThrow(/REDIS_URL/);
  });
});
