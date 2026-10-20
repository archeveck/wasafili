import { type INestApplication } from '@nestjs/common';
import { inspectionEquipement } from '@wasafili/form-schema';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { tenantTransaction } from '../src/prisma/tenant';
import { api, createTenant, createTestApp, login, owner, resetDatabase } from './helpers';

let app: INestApplication;
let tenant: Awaited<ReturnType<typeof createTenant>>;
let admin: ReturnType<typeof api>;
let technicien: ReturnType<typeof api>;

const field = (key: string, extra: Record<string, unknown> = {}) => ({
  id: `id-${key}`,
  key,
  label: key,
  type: 'text',
  ...extra,
});
const definition = (fields: unknown[]) => ({ schemaVersion: 1, fields });

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase();
  tenant = await createTenant('acme');
  admin = api(app, (await login(app, 'admin@acme.test')).access_token);
  technicien = api(app, (await login(app, 'technicien@acme.test')).access_token);
});

describe('cycle de vie d une structure', () => {
  it('crée, enregistre le brouillon, publie, puis versionne', async () => {
    const created = await admin
      .post('/v1/acme/structures')
      .send({ name: 'Visite chantier' })
      .expect(201);
    expect(created.body).toMatchObject({ currentVersion: null, draftVersion: 1 });
    const id = created.body.id as string;

    await admin
      .put(`/v1/acme/structures/${id}/draft`)
      .send({ definition: definition([field('a')]) })
      .expect(200);
    const published = await admin.post(`/v1/acme/structures/${id}/publish`).expect(200);
    expect(published.body).toMatchObject({ version: 1, status: 'PUBLISHED' });

    await admin.post(`/v1/acme/structures/${id}/publish`).expect(409);

    const v2 = await admin
      .put(`/v1/acme/structures/${id}/draft`)
      .send({ definition: definition([field('a'), field('b')]) })
      .expect(200);
    expect(v2.body).toMatchObject({ version: 2, status: 'DRAFT' });
    await admin.post(`/v1/acme/structures/${id}/publish`).expect(200);

    const detail = await admin.get(`/v1/acme/structures/${id}`).expect(200);
    expect(detail.body).toMatchObject({ currentVersion: 2, draftVersion: null });
    expect(detail.body.versions.map((v: { status: string }) => v.status)).toEqual([
      'PUBLISHED',
      'ARCHIVED',
    ]);

    const v1 = await admin.get(`/v1/acme/structures/${id}/versions/1`).expect(200);
    expect(v1.body.definition.fields).toHaveLength(1);
    const current = await admin.get(`/v1/acme/structures/${id}/versions/current`).expect(200);
    expect(current.body.version).toBe(2);
    await admin.get(`/v1/acme/structures/${id}/versions/draft`).expect(404);
    await admin.get(`/v1/acme/structures/${id}/versions/zero`).expect(400);
  });

  it('refuse une définition invalide avec le détail des problèmes', async () => {
    const res = await admin
      .post('/v1/acme/structures')
      .send({
        name: 'Invalide',
        definition: definition([
          field('total', { type: 'calculated', formula: '{prix} *', resultType: 'number' }),
        ]),
      })
      .expect(422);
    expect(res.body).toMatchObject({ error: 'invalid_definition' });
    expect(res.body.details[0]).toMatchObject({ code: 'formula', field: 'total' });
  });

  it('accepte la structure de démonstration complète', async () => {
    await admin
      .post('/v1/acme/structures')
      .send({ name: 'Inspection', definition: inspectionEquipement({ listId: 'liste' }) })
      .expect(201);
  });

  it('garantit en base l immutabilité d une version publiée', async () => {
    const { body } = await admin
      .post('/v1/acme/structures')
      .send({ name: 'Figée', definition: definition([field('a')]) })
      .expect(201);
    await admin.post(`/v1/acme/structures/${body.id}/publish`).expect(200);
    await expect(
      tenantTransaction(owner(), { instanceId: tenant.instance.id }, (tx) =>
        tx.structureVersion.updateMany({
          where: { structureId: body.id },
          data: { definition: { schemaVersion: 1, fields: [] } },
        }),
      ),
    ).rejects.toThrow(/immuable/);
  });

  it('renomme, liste et archive', async () => {
    const { body } = await admin
      .post('/v1/acme/structures')
      .send({ name: 'Ancien nom' })
      .expect(201);
    await admin.patch(`/v1/acme/structures/${body.id}`).send({ name: 'Nouveau nom' }).expect(200);
    await admin.patch(`/v1/acme/structures/${body.id}`).send({}).expect(400);
    expect((await admin.get('/v1/acme/structures').expect(200)).body.data[0].name).toBe(
      'Nouveau nom',
    );

    await admin.delete(`/v1/acme/structures/${body.id}`).expect(204);
    expect((await admin.get('/v1/acme/structures').expect(200)).body.meta.total).toBe(0);
    expect(
      (await admin.get('/v1/acme/structures?include_archived=true').expect(200)).body.meta.total,
    ).toBe(1);
  });

  it('expose le JSON Schema de la définition', async () => {
    const res = await admin.get('/v1/acme/structures/schema').expect(200);
    expect(res.body.type).toBe('object');
  });
});

describe('droits', () => {
  it('le technicien lit les structures mais ne les modifie pas', async () => {
    const { body } = await admin.post('/v1/acme/structures').send({ name: 'S' }).expect(201);
    await technicien.get('/v1/acme/structures').expect(200);
    await technicien.get(`/v1/acme/structures/${body.id}`).expect(200);
    await technicien.post('/v1/acme/structures').send({ name: 'X' }).expect(403);
    await technicien
      .put(`/v1/acme/structures/${body.id}/draft`)
      .send({ definition: definition([]) })
      .expect(403);
    await technicien.post(`/v1/acme/structures/${body.id}/publish`).expect(403);
    await technicien.delete(`/v1/acme/structures/${body.id}`).expect(403);
  });

  it('répond 404 pour une structure inconnue', async () => {
    await admin.get('/v1/acme/structures/00000000-0000-4000-8000-000000000000').expect(404);
  });
});
