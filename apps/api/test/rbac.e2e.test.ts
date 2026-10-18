import { type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createTenant, createTestApp, login, resetDatabase } from './helpers';

let app: INestApplication;
const tokens: Record<'admin' | 'superviseur' | 'technicien', string> = {
  admin: '',
  superviseur: '',
  technicien: '',
};

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase();
  await createTenant('acme');
  for (const role of Object.keys(tokens) as (keyof typeof tokens)[]) {
    tokens[role] = (await login(app, `${role}@acme.test`)).access_token;
  }
});

describe('matrice de droits (rôles système)', () => {
  it.each([
    ['admin', 'get', '/v1/acme/users', 200],
    ['admin', 'get', '/v1/acme/roles', 200],
    ['admin', 'post', '/v1/acme/groups', 201],
    ['superviseur', 'get', '/v1/acme/users', 200],
    ['superviseur', 'get', '/v1/acme/roles', 200],
    ['superviseur', 'post', '/v1/acme/groups', 201],
    ['technicien', 'get', '/v1/acme/users', 403],
    ['technicien', 'get', '/v1/acme/roles', 403],
    ['technicien', 'get', '/v1/acme/groups', 403],
    ['technicien', 'post', '/v1/acme/groups', 403],
  ] as const)('%s %s %s → %i', async (role, method, url, status) => {
    const res = await api(app, tokens[role])
      [method](url)
      .send({ name: `Groupe ${role}` });
    expect(res.status).toBe(status);
    if (status === 403) expect(res.body.error).toBe('forbidden');
  });
});

describe('permissions de l appelant', () => {
  it('expose rôle et permissions dans l instance', async () => {
    const res = await api(app, tokens.technicien).get('/v1/acme/me').expect(200);
    expect(res.body).toMatchObject({ kind: 'user', roles: ['technicien'] });
    expect(res.body.permissions).toContain('submission:create');
    expect(res.body.permissions).not.toContain('user:read');
  });
});

describe('conventions de l API', () => {
  it('pagine avec page/per_page et restreint les champs avec fields=', async () => {
    const res = await api(app, tokens.admin)
      .get('/v1/acme/users?per_page=2&page=2&fields=email')
      .expect(200);
    expect(res.body.meta).toEqual({ page: 2, perPage: 2, total: 3, totalPages: 2 });
    expect(res.body.data).toHaveLength(1);
    expect(Object.keys(res.body.data[0]).sort()).toEqual(['email', 'id']);
  });

  it('refuse une pagination invalide', async () => {
    const res = await api(app, tokens.admin).get('/v1/acme/users?per_page=500').expect(400);
    expect(res.body).toMatchObject({ statusCode: 400, error: 'validation_failed' });
    expect(res.body.details[0].path).toBe('per_page');
  });

  it('valide le corps des requêtes et signale les doublons', async () => {
    await api(app, tokens.admin).post('/v1/acme/groups').send({ name: '' }).expect(400);
    await api(app, tokens.admin).post('/v1/acme/groups').send({ name: 'Nord' }).expect(201);
    const dup = await api(app, tokens.admin)
      .post('/v1/acme/groups')
      .send({ name: 'Nord' })
      .expect(409);
    expect(dup.body.error).toBe('conflict');
  });

  it('refuse un identifiant mal formé', async () => {
    await api(app, tokens.admin).get('/v1/acme/groups/pas-un-uuid').expect(400);
  });

  it('expose /health hors préfixe de version', async () => {
    const res = await api(app).get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', checks: { database: 'up', redis: 'up' } });
  });
});
