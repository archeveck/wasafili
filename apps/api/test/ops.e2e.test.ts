import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTenant, createTestApp, login, resetDatabase } from './helpers';

let app: INestApplication;

beforeAll(async () => {
  await resetDatabase();
  await createTenant('acme');
  // Conversion PDF injoignable : dépendance facultative, l'API reste disponible (dégradée).
  app = await createTestApp({
    GOTENBERG_URL: 'http://127.0.0.1:9',
    METRICS_TOKEN: 'jeton-metriques-de-test',
  });
});

afterAll(async () => {
  await app.close();
});

describe('exploitation (P7.2.2)', () => {
  it('sonde de disponibilité : dépendances indispensables et facultatives', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toEqual({
      status: 'degraded',
      checks: { database: 'up', redis: 'up', storage: 'up', pdf: 'down' },
    });
    await request(app.getHttpServer()).get('/health/live').expect(200, { status: 'ok' });
  });

  it('métriques Prometheus par route déclarée, protégées par jeton', async () => {
    const admin = api(app, (await login(app, 'admin@acme.test')).access_token);
    await admin.get('/v1/acme/structures').expect(200);
    await admin.get('/v1/acme/structures/00000000-0000-4000-8000-000000000000').expect(404);

    await request(app.getHttpServer()).get('/metrics').expect(404);
    const res = await request(app.getHttpServer())
      .get('/metrics')
      .set('Authorization', 'Bearer jeton-metriques-de-test')
      .expect(200);
    expect(res.text).toMatch(
      /wasafili_http_requests_total\{method="GET",route="\/v1\/:app\/structures",status="200",service="api"\} 1/,
    );
    expect(res.text).toContain('route="/v1/:app/structures/:id",status="404"');
    expect(res.text).toContain('nodejs_eventloop_lag_seconds');
    expect(res.text).not.toContain('route="/health"');
  });

  it('identifiant de requête : repris du proxy ou généré, renvoyé au client', async () => {
    const given = await request(app.getHttpServer())
      .get('/v1/openapi.json')
      .set('X-Request-Id', 'nginx-0123abcd')
      .expect(200);
    expect(given.headers['x-request-id']).toBe('nginx-0123abcd');
    const forged = await request(app.getHttpServer())
      .get('/v1/openapi.json')
      .set('X-Request-Id', 'avec espace\tet tabulation')
      .expect(200);
    expect(forged.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('en-têtes de sécurité sur toute réponse, CORS fermé aux origines non listées', async () => {
    const res = await request(app.getHttpServer()).get('/v1/apps').expect(401);
    expect(res.headers).toMatchObject({
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      'cache-control': 'no-store',
    });
    expect(res.headers['x-powered-by']).toBeUndefined();

    const preflight = await request(app.getHttpServer())
      .options('/v1/oauth/token')
      .set('Origin', 'https://pirate.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
  });
});
