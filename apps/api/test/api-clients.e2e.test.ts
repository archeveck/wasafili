import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  api,
  createOAuthClient,
  createTenant,
  createTestApp,
  login,
  resetDatabase,
} from './helpers';

let app: INestApplication;
let admin: ReturnType<typeof api>;
let tenant: Awaited<ReturnType<typeof createTenant>>;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase();
  tenant = await createTenant('acme');
  await createTenant('beta');
  admin = api(app, (await login(app, 'admin@acme.test')).access_token);
});

const tokenFor = (clientId: string, clientSecret: string) =>
  request(app.getHttpServer())
    .post('/v1/oauth/token')
    .type('form')
    .send({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret });

type Created = { id: string; clientId: string; clientSecret: string; scopes: string[] };

async function createKey(scopes: string[], name = 'n8n'): Promise<Created> {
  const res = await admin.post('/v1/acme/api-clients').send({ name, scopes }).expect(201);
  return res.body as Created;
}

describe('clés API (P7.1.4)', () => {
  it('crée une clé dont le secret n’est montré qu’une fois et sert au grant client_credentials', async () => {
    const key = await createKey(['structure:read', 'list:read']);
    expect(key.clientId).toMatch(/^tsx_[0-9a-f]{24}$/);
    expect(key.clientSecret).toMatch(/^tsxsk_/);
    expect(key.scopes).toEqual(['list:read', 'structure:read']);

    const listed = await admin.get('/v1/acme/api-clients').expect(200);
    expect(listed.body.data).toHaveLength(1);
    expect(JSON.stringify(listed.body)).not.toContain(key.clientSecret);

    const token = await tokenFor(key.clientId, key.clientSecret).expect(200);
    expect(token.body.scope).toBe('list:read structure:read');
    const client = api(app, token.body.access_token as string);
    await client.get('/v1/acme/structures').expect(200);
    await client.get('/v1/acme/users').expect(403);
    await client.get('/v1/beta/structures').expect(404);

    const detail = await admin.get(`/v1/acme/api-clients/${key.id}`).expect(200);
    expect(detail.body.lastUsedAt).not.toBeNull();
  });

  it('applique tout de suite un changement de permissions et une révocation', async () => {
    const key = await createKey(['structure:read']);
    const token = (await tokenFor(key.clientId, key.clientSecret).expect(200)).body
      .access_token as string;
    const client = api(app, token);
    await client.get('/v1/acme/structures').expect(200);

    await admin
      .patch(`/v1/acme/api-clients/${key.id}`)
      .send({ scopes: ['list:read'] })
      .expect(200);
    await client.get('/v1/acme/structures').expect(403);
    await client.get('/v1/acme/lists').expect(200);

    await admin.delete(`/v1/acme/api-clients/${key.id}`).expect(204);
    const refused = await client.get('/v1/acme/lists').expect(401);
    expect(refused.body.error).toBe('invalid_token');
    await tokenFor(key.clientId, key.clientSecret).expect(401);
    await admin.patch(`/v1/acme/api-clients/${key.id}`).send({ name: 'x' }).expect(409);
    await admin.delete(`/v1/acme/api-clients/${key.id}`).expect(204);
    const listed = await admin.get('/v1/acme/api-clients').expect(200);
    expect(listed.body.data[0].revokedAt).not.toBeNull();
  });

  it('remplace le secret : l’ancien est refusé', async () => {
    const key = await createKey(['structure:read']);
    const rotated = await admin.post(`/v1/acme/api-clients/${key.id}/secret`).expect(200);
    expect(rotated.body.clientSecret).not.toBe(key.clientSecret);
    await tokenFor(key.clientId, key.clientSecret).expect(401);
    await tokenFor(key.clientId, rotated.body.clientSecret as string).expect(200);
  });

  it('ne délègue que des permissions détenues, et reste réservé à apikey:manage', async () => {
    const delegate = await createOAuthClient(tenant.instance.id, ['apikey:manage', 'list:read']);
    const token = (await tokenFor(delegate.clientId, delegate.secret).expect(200)).body
      .access_token as string;
    const client = api(app, token);
    await client
      .post('/v1/acme/api-clients')
      .send({ name: 'x', scopes: ['list:read'] })
      .expect(201);
    const refused = await client
      .post('/v1/acme/api-clients')
      .send({ name: 'x', scopes: ['user:manage'] })
      .expect(403);
    expect(refused.body.message).toContain('user:manage');

    const superviseur = api(app, (await login(app, 'superviseur@acme.test')).access_token);
    await superviseur.get('/v1/acme/api-clients').expect(403);
    await admin
      .post('/v1/acme/api-clients')
      .send({ name: 'x', scopes: ['inconnue:permission'] })
      .expect(400);
  });

  it('journalise création, modification, rotation et révocation sans le secret', async () => {
    const key = await createKey(['structure:read'], 'ERP');
    await admin.patch(`/v1/acme/api-clients/${key.id}`).send({ name: 'ERP compta' }).expect(200);
    await admin.post(`/v1/acme/api-clients/${key.id}/secret`).expect(200);
    await admin.delete(`/v1/acme/api-clients/${key.id}`).expect(204);
    const res = await admin.get('/v1/acme/audit-logs?action=apikey').expect(200);
    const entries = res.body.data as { action: string; targetId: string; targetLabel: string }[];
    expect(entries.map((e) => e.action).sort()).toEqual([
      'apikey.create',
      'apikey.revoke',
      'apikey.secret',
      'apikey.update',
    ]);
    expect(entries.every((e) => e.targetId === key.id)).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(key.clientSecret);
  });
});
