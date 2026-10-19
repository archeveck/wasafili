import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers';

describe('Documentation de l’API (P7.1.2)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('publie le document OpenAPI 3.1 sans authentification', async () => {
    const res = await request(app.getHttpServer()).get('/v1/openapi.json').expect(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    const document = res.body as { openapi: string; paths: object };
    expect(document.openapi).toBe('3.1.0');
    expect(Object.keys(document.paths)).toContain('/v1/{app}/structures/{structureId}/submissions');
  });

  it('sert la page interactive et ses fichiers, sous une CSP stricte', async () => {
    const page = await request(app.getHttpServer()).get('/v1/docs').expect(200);
    expect(page.text).toContain('swagger-ui-bundle.js');
    expect(page.headers['content-security-policy']).toContain("script-src 'self'");
    await request(app.getHttpServer())
      .get('/v1/docs/assets/swagger-ui-bundle.js')
      .expect(200)
      .expect('Content-Type', /javascript/);
    const init = await request(app.getHttpServer()).get('/v1/docs/init.js').expect(200);
    expect(init.text).toContain("url: 'openapi.json'");
  });
});
