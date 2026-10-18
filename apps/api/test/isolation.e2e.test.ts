import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { tenantTransaction } from '../src/prisma/tenant';
import { seedDemoContent } from '../src/seed/seed-demo';
import {
  api,
  createOAuthClient,
  createTenant,
  createTestApp,
  login,
  owner,
  resetDatabase,
} from './helpers';

/** Isolation au niveau HTTP : chaque endpoint d'instance, appelé depuis une autre instance. */
let app: INestApplication;
let a: Awaited<ReturnType<typeof createTenant>>;
let b: Awaited<ReturnType<typeof createTenant>>;
let groupB: { id: string };
let tokenA: string;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase();
  a = await createTenant('alpha');
  b = await createTenant('beta');
  await tenantTransaction(owner(), { instanceId: a.instance.id }, (tx) =>
    tx.group.create({ data: { instanceId: a.instance.id, name: 'Équipe A' } }),
  );
  groupB = await tenantTransaction(owner(), { instanceId: b.instance.id }, (tx) =>
    tx.group.create({ data: { instanceId: b.instance.id, name: 'Équipe B' } }),
  );
  tokenA = (await login(app, 'admin@alpha.test')).access_token;
});

const instanceEndpoints = [
  ['get', '/users'],
  ['get', '/roles'],
  ['get', '/groups'],
  ['post', '/groups'],
  ['get', '/structures'],
  ['post', '/structures'],
  ['get', '/lists'],
  ['post', '/lists'],
  ['get', '/list-items?code=EQ-0001'],
  ['get', '/settings'],
  ['patch', '/settings'],
  ['post', '/files/upload'],
] as const;

describe('un administrateur de A', () => {
  it.each(instanceEndpoints)('%s /v1/beta%s → 404', async (method, path) => {
    const res = await api(app, tokenA)[method](`/v1/beta${path}`).send({ name: 'x' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });

  it('obtient la même réponse pour une instance inexistante', async () => {
    const missing = await api(app, tokenA).get('/v1/inexistante/users').expect(404);
    const foreign = await api(app, tokenA).get('/v1/beta/users').expect(404);
    expect(missing.body).toEqual(foreign.body);
  });

  it('ne lit pas un groupe de B par son identifiant via sa propre instance', async () => {
    await api(app, tokenA).get(`/v1/alpha/groups/${groupB.id}`).expect(404);
  });

  it('ne voit que les données de A dans les listings et les comptages', async () => {
    const groups = await api(app, tokenA).get('/v1/alpha/groups').expect(200);
    expect(groups.body.data.map((group: { name: string }) => group.name)).toEqual(['Équipe A']);
    expect(groups.body.meta.total).toBe(1);

    const users = await api(app, tokenA).get('/v1/alpha/users').expect(200);
    expect(users.body.meta.total).toBe(3);
    expect(
      users.body.data.every((user: { email: string }) => user.email.endsWith('@alpha.test')),
    ).toBe(true);
  });

  it('crée un groupe rattaché à A uniquement', async () => {
    await api(app, tokenA).post('/v1/alpha/groups').send({ name: 'Nouveau' }).expect(201);
    const inB = await tenantTransaction(owner(), { instanceId: b.instance.id }, (tx) =>
      tx.group.findMany(),
    );
    expect(inB.map((group) => group.name)).toEqual(['Équipe B']);
  });

  it('ne liste que ses instances dans /v1/apps', async () => {
    const res = await api(app, tokenA).get('/v1/apps').expect(200);
    expect(res.body.data.map((instance: { short: string }) => instance.short)).toEqual(['alpha']);
  });
});

describe('ressources de la Phase 1', () => {
  it('ne donne accès à aucune structure, fiche ou liste de B par identifiant', async () => {
    const demoB = await seedDemoContent(owner(), b.instance.id);
    const tokenB = (await login(app, 'technicien@beta.test')).access_token;
    const submission = await api(app, tokenB)
      .post(`/v1/beta/structures/${demoB.structure.id}/submissions`)
      .send({ data: {} });
    const submissionId = submission.body.id ?? '00000000-0000-4000-8000-000000000000';

    const client = api(app, tokenA);
    await client.get(`/v1/alpha/structures/${demoB.structure.id}`).expect(404);
    await client.get(`/v1/alpha/structures/${demoB.structure.id}/submissions`).expect(404);
    await client
      .post(`/v1/alpha/structures/${demoB.structure.id}/submissions`)
      .send({ data: {} })
      .expect(404);
    await client.get(`/v1/alpha/submissions/${submissionId}`).expect(404);
    await client.get(`/v1/alpha/lists/${demoB.list.id}`).expect(404);
    await client.get(`/v1/alpha/lists/${demoB.list.id}/items`).expect(404);
    expect((await client.get('/v1/alpha/list-items?code=EQ-0001').expect(200)).body.data).toEqual(
      [],
    );
  });
});

describe('un utilisateur membre de A et de B', () => {
  beforeEach(async () => {
    await tenantTransaction(owner(), { instanceId: b.instance.id }, (tx) =>
      tx.membership.create({
        data: {
          instanceId: b.instance.id,
          userId: a.users[0]!.id,
          roleId: b.roles.get('technicien')!,
        },
      }),
    );
  });

  it('voit ses deux instances et y a les droits de chacun de ses rôles', async () => {
    const apps = await api(app, tokenA).get('/v1/apps').expect(200);
    expect(apps.body.data.map((instance: { short: string }) => instance.short).sort()).toEqual([
      'alpha',
      'beta',
    ]);
    await api(app, tokenA).get('/v1/alpha/users').expect(200);
    await api(app, tokenA).get('/v1/beta/users').expect(403); // technicien dans beta
  });

  it('n apparaît pas en double dans la liste des membres de A', async () => {
    const users = await api(app, tokenA).get('/v1/alpha/users').expect(200);
    expect(users.body.meta.total).toBe(3);
  });
});

describe('un client d intégration de A', () => {
  it('n accède pas à B', async () => {
    const { clientId, secret } = await createOAuthClient(a.instance.id, ['user:read']);
    const res = await request(app.getHttpServer())
      .post('/v1/oauth/token')
      .auth(clientId, secret)
      .send({ grant_type: 'client_credentials' })
      .expect(200);
    await api(app, res.body.access_token).get('/v1/alpha/users').expect(200);
    await api(app, res.body.access_token).get('/v1/beta/users').expect(404);
  });
});
