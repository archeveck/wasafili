import { type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  api,
  createOAuthClient,
  createTenant,
  createTestApp,
  login,
  resetDatabase,
} from './helpers';
import request from 'supertest';

let app: INestApplication;
let tenant: Awaited<ReturnType<typeof createTenant>>;

beforeAll(async () => {
  await resetDatabase();
  tenant = await createTenant('acme');
  await createTenant('beta');
  app = await createTestApp({
    RATE_LIMIT_USER_PER_MINUTE: '3',
    RATE_LIMIT_CLIENT_PER_MINUTE: '2',
    RATE_LIMIT_INSTANCE_PER_MINUTE: '6',
  });
});

afterAll(async () => {
  await app.close();
});

describe('limitation de débit (P7.1.5)', () => {
  it('limite chaque utilisateur, avec les en-têtes RateLimit et Retry-After', async () => {
    const admin = api(app, (await login(app, 'admin@beta.test')).access_token);
    const remaining: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await admin.get('/v1/beta/structures').expect(200);
      expect(res.headers['ratelimit-limit']).toBe('3');
      remaining.push(res.headers['ratelimit-remaining'] as string);
    }
    expect(remaining).toEqual(['2', '1', '0']);
    const refused = await admin.get('/v1/beta/structures').expect(429);
    expect(refused.body.error).toBe('rate_limited');
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(refused.headers['retry-after'])).toBeLessThanOrEqual(60);
  });

  it('limite chaque client d’intégration et borne la charge totale d’une instance', async () => {
    const { clientId, secret } = await createOAuthClient(tenant.instance.id, ['structure:read']);
    const token = await request(app.getHttpServer())
      .post('/v1/oauth/token')
      .send({ grant_type: 'client_credentials', client_id: clientId, client_secret: secret })
      .expect(200);
    const client = api(app, token.body.access_token as string);
    await client.get('/v1/acme/structures').expect(200);
    await client.get('/v1/acme/structures').expect(200);
    await client.get('/v1/acme/structures').expect(429);

    // Instance acme : 3 requêtes déjà comptées (dont le refus) ; il en reste 3 en tout.
    const admin = api(app, (await login(app, 'admin@acme.test')).access_token);
    const superviseur = api(app, (await login(app, 'superviseur@acme.test')).access_token);
    await admin.get('/v1/acme/structures').expect(200);
    await superviseur.get('/v1/acme/structures').expect(200);
    await admin.get('/v1/acme/structures').expect(200);
    await superviseur.get('/v1/acme/structures').expect(429);
    // Une autre instance n'en pâtit pas (beta n'est limitée que par son utilisateur, épuisé).
    const technicien = api(app, (await login(app, 'technicien@beta.test')).access_token);
    await technicien.get('/v1/beta/structures').expect(200);
  });

  it('ne limite ni la santé ni la documentation', async () => {
    for (let i = 0; i < 5; i += 1) {
      const res = await request(app.getHttpServer()).get('/v1/openapi.json').expect(200);
      expect(res.headers['ratelimit-limit']).toBeUndefined();
    }
  });
});
