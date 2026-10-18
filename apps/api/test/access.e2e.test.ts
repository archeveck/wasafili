import { type INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createDemoTenant, createTestApp, demoItems, login, resetDatabase } from './helpers';

/** Droits par structure (P2.6.2), filtres de visibilité (P2.6.3), matrice d'autorisation (P2.6.4). */
let app: INestApplication;
let tenant: Awaited<ReturnType<typeof createDemoTenant>>;
let items: Record<string, string>;
let admin: ReturnType<typeof api>;
let superviseur: ReturnType<typeof api>;
let technicien: ReturnType<typeof api>;
let base: string;

const fileId = randomUUID();
const data = (equipement: string, site = items['S-PLT']!, batiment = items['B-PLT-A']!) => ({
  site,
  batiment,
  equipement,
  etat: 'bon',
  signature: { fileId },
});
const roleId = (key: string) => tenant.roles.get(key as never)!;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase();
  tenant = await createDemoTenant('acme');
  items = await demoItems(tenant.instance.id);
  base = `/v1/acme/structures/${tenant.structure.id}`;
  admin = api(app, (await login(app, 'admin@acme.test')).access_token);
  superviseur = api(app, (await login(app, 'superviseur@acme.test')).access_token);
  technicien = api(app, (await login(app, 'technicien@acme.test')).access_token);
  // Le site d'un équipement doit être filtrable pour servir de filtre de visibilité.
  const current = await admin.get(`${base}/versions/current`).expect(200);
  const definition = current.body.definition;
  definition.fields[0].fields[0].filterable = true;
  await admin.put(`${base}/draft`).send({ definition }).expect(200);
  await admin.post(`${base}/publish`).expect(200);
});

const setRules = (rules: unknown[]) => admin.put(`${base}/access`).send({ rules });

describe('règles par structure', () => {
  it('sans règle, les permissions d instance s appliquent', async () => {
    await technicien
      .post(`${base}/submissions`)
      .send({ data: data(items['EQ-0001']!) })
      .expect(201);
    await technicien.get(`${base}/submissions/export`).expect(403);
    await superviseur.get(`${base}/submissions/export?format=csv`).expect(200);
  });

  it('une règle remplace les permissions d instance pour les rôles visés', async () => {
    await setRules([{ roleId: roleId('technicien'), permissions: ['read:own'] }]).expect(200);
    const res = await technicien
      .post(`${base}/submissions`)
      .send({ data: data(items['EQ-0001']!) });
    expect(res.status).toBe(403);
    expect(res.body.message).toContain('create');
    // Le superviseur n'a pas de règle : plus aucun droit sur cette structure.
    await superviseur.get(`${base}/submissions`).expect(403);
    // L'administrateur d'instance garde tous les droits.
    await admin.get(`${base}/submissions`).expect(200);
  });

  it('accorde des droits par groupe, cumulés avec ceux du rôle', async () => {
    const group = await admin.post('/v1/acme/groups').send({ name: 'Export' }).expect(201);
    await admin
      .put(`/v1/acme/groups/${group.body.id}/members`)
      .send({ userIds: [tenant.users[2]!.id] })
      .expect(200);
    await setRules([
      { roleId: roleId('technicien'), permissions: ['create', 'read:own'] },
      { groupId: group.body.id, permissions: ['export'] },
    ]).expect(200);
    await technicien
      .post(`${base}/submissions`)
      .send({ data: data(items['EQ-0001']!) })
      .expect(201);
    await technicien.get(`${base}/submissions/export?format=csv`).expect(200);
  });

  it('valide les règles', async () => {
    await setRules([{ permissions: ['create'] }]).expect(400);
    await setRules([
      { roleId: roleId('technicien'), permissions: ['create'] },
      { roleId: roleId('technicien'), permissions: ['export'] },
    ]).expect(400);
    await setRules([
      {
        roleId: roleId('technicien'),
        permissions: ['read:all'],
        visibility: [{ key: 'description_defaut', value: 'x' }],
      },
    ]).expect(400);
    await setRules([{ roleId: roleId('technicien'), permissions: ['tout'] }]).expect(400);
    await technicien.put(`${base}/access`).send({ rules: [] }).expect(403);
    expect((await superviseur.get(`${base}/access`).expect(200)).body.data).toEqual([]);
  });
});

describe('filtres de visibilité', () => {
  beforeEach(async () => {
    await admin
      .post(`${base}/submissions`)
      .send({ data: data(items['EQ-0001']!) })
      .expect(201);
    await admin
      .post(`${base}/submissions`)
      .send({ data: data(items['EQ-0101']!, items['S-YOP'], items['B-YOP-3']) })
      .expect(201);
    await setRules([
      {
        roleId: roleId('superviseur'),
        permissions: ['read:all', 'update'],
        visibility: [{ key: 'site', operator: 'eq', value: '$user.site' }],
      },
    ]).expect(200);
  });

  it('ne montre que les fiches du site du membre', async () => {
    const superviseurId = tenant.users[1]!.id;
    await admin
      .patch(`/v1/acme/users/${superviseurId}`)
      .send({ attributes: { site: items['S-YOP'] } })
      .expect(200);
    const list = await superviseur.get(`${base}/submissions`).expect(200);
    expect(list.body.data.map((s: { data: { site: string } }) => s.data.site)).toEqual([
      items['S-YOP'],
    ]);

    const all = await admin.get(`${base}/submissions`).expect(200);
    const hidden = all.body.data.find(
      (s: { data: { site: string } }) => s.data.site === items['S-PLT'],
    );
    await superviseur.get(`/v1/acme/submissions/${hidden.id}`).expect(404);
    await superviseur.patch(`/v1/acme/submissions/${hidden.id}`).send({ data: {} }).expect(404);
  });

  it('ne donne accès à rien si l attribut du membre est absent', async () => {
    expect((await superviseur.get(`${base}/submissions`).expect(200)).body.meta.total).toBe(0);
  });
});

describe('export', () => {
  it('produit un fichier avec des libellés lisibles', async () => {
    await admin
      .post(`${base}/submissions`)
      .send({ data: data(items['EQ-0001']!) })
      .expect(201);
    const res = await admin
      .get(`${base}/submissions/export?format=csv&filter[etat]=bon`)
      .expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const text = res.text.replace(/^\uFEFF/, '');
    const [header, row] = text.trim().split('\n');
    expect(header).toContain('Équipement');
    expect(row).toContain('Groupe électrogène 250 kVA');
    expect(row).toContain('Bon');
    expect(row).toContain('admin@acme.test');
  });

  it('respecte les filtres de visibilité', async () => {
    await admin
      .post(`${base}/submissions`)
      .send({ data: data(items['EQ-0001']!) })
      .expect(201);
    await setRules([
      {
        roleId: roleId('superviseur'),
        permissions: ['read:all', 'export'],
        visibility: [{ key: 'site', value: '$user.site' }],
      },
    ]).expect(200);
    const res = await superviseur.get(`${base}/submissions/export?format=csv`).expect(200);
    expect(res.text.trim().split('\n')).toHaveLength(1); // en-tête seul
  });
});
