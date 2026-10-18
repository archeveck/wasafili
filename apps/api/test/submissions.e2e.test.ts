import { type INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createDemoTenant, createTestApp, demoItems, login, resetDatabase } from './helpers';

let app: INestApplication;
let tenant: Awaited<ReturnType<typeof createDemoTenant>>;
let items: Record<string, string>;
let admin: ReturnType<typeof api>;
let superviseur: ReturnType<typeof api>;
let technicien: ReturnType<typeof api>;
let url: string;

const fileId = randomUUID();
const valid = () => ({
  site: items['S-PLT'],
  batiment: items['B-PLT-A'],
  equipement: items['EQ-0001'],
  etat: 'degrade',
  description_defaut: 'Fuite d huile',
  photos: [{ fileId }],
  pieces: [
    { _id: 'r1', reference: 'FLT-01', quantite: 2, prix_unitaire: 12500, montant: 1 },
    { _id: 'r2', reference: 'JNT-04', prix_unitaire: 3000 },
  ],
  total_pieces: 999,
  inspecteur: 'usurpation',
  signature: { fileId },
});

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
  url = `/v1/acme/structures/${tenant.structure.id}/submissions`;
  admin = api(app, (await login(app, 'admin@acme.test')).access_token);
  superviseur = api(app, (await login(app, 'superviseur@acme.test')).access_token);
  technicien = api(app, (await login(app, 'technicien@acme.test')).access_token);
});

describe('création', () => {
  it('valide, applique défauts et champs automatiques, recalcule côté serveur', async () => {
    const res = await technicien
      .post(url)
      .send({ data: valid(), location: { lat: 5.32, lng: -4.02, accuracy: 6 } })
      .expect(201);
    const technicienId = tenant.users[2]!.id;
    expect(res.body).toMatchObject({
      version: 1,
      revision: 1,
      state: 'brouillon',
      authorId: technicienId,
      location: { lat: 5.32, lng: -4.02, accuracy: 6 },
    });
    expect(res.body.data).toMatchObject({
      inspecteur: technicienId,
      total_pieces: 25000,
      date_inspection: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      cree_le: expect.any(String),
    });
    expect(res.body.data.pieces).toEqual([
      { _id: 'r1', reference: 'FLT-01', quantite: 2, prix_unitaire: 12500, montant: 25000 },
      { _id: 'r2', reference: 'JNT-04', prix_unitaire: 3000, montant: null },
    ]);
  });

  it('refuse des données invalides avec des erreurs localisables', async () => {
    const res = await technicien
      .post(url)
      .send({ data: { ...valid(), etat: 'hors_service', description_defaut: '', intrus: 1 } })
      .expect(422);
    expect(res.body.error).toBe('invalid_data');
    expect(res.body.details).toEqual([
      { path: ['intrus'], field: 'intrus', code: 'unknown_field' },
      { path: ['description_defaut'], field: 'description_defaut', code: 'required' },
    ]);
  });

  it('conserve l identifiant généré par le client', async () => {
    const id = randomUUID();
    const res = await technicien.post(url).send({ id, data: valid() }).expect(201);
    expect(res.body.id).toBe(id);
    await technicien.post(url).send({ id, data: valid() }).expect(409);
  });

  it('est idempotente par clientMutationId, y compris en envois simultanés', async () => {
    const body = { id: randomUUID(), clientMutationId: 'm-1', data: valid() };
    const first = await technicien.post(url).send(body).expect(201);
    const replay = await technicien
      .post(url)
      .send({ ...body, data: {} })
      .expect(200);
    expect(replay.body).toEqual(first.body);

    const concurrent = { id: randomUUID(), clientMutationId: 'm-2', data: valid() };
    const results = await Promise.all([1, 2, 3].map(() => technicien.post(url).send(concurrent)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    const list = await admin.get(url).expect(200);
    expect(list.body.meta.total).toBe(2);
  });

  it('exige une version publiée et la permission de créer', async () => {
    const { body } = await admin
      .post('/v1/acme/structures')
      .send({ name: 'Brouillon' })
      .expect(201);
    await technicien
      .post(`/v1/acme/structures/${body.id}/submissions`)
      .send({ data: {} })
      .expect(409);
    await technicien
      .post('/v1/acme/structures/00000000-0000-4000-8000-000000000000/submissions')
      .send({ data: {} })
      .expect(404);
  });
});

describe('modification et historique', () => {
  it('fusionne les champs fournis, recalcule et trace chaque changement', async () => {
    const { body: created } = await technicien.post(url).send({ data: valid() }).expect(201);
    const updated = await technicien
      .patch(`/v1/acme/submissions/${created.id}`)
      .send({
        data: { pieces: [{ _id: 'r1', reference: 'FLT-01', quantite: 3, prix_unitaire: 12500 }] },
        clientMutationId: 'u-1',
      })
      .expect(200);
    expect(updated.body).toMatchObject({ revision: 2 });
    expect(updated.body.data).toMatchObject({
      total_pieces: 37500,
      description_defaut: 'Fuite d huile',
    });

    // Rejeu : aucun effet.
    await technicien
      .patch(`/v1/acme/submissions/${created.id}`)
      .send({ data: { etat: 'bon' }, clientMutationId: 'u-1' })
      .expect(200);
    // Modification sans effet réel : pas de nouvelle révision.
    const same = await technicien
      .patch(`/v1/acme/submissions/${created.id}`)
      .send({ data: { etat: 'degrade' } })
      .expect(200);
    expect(same.body.revision).toBe(2);

    const history = await technicien
      .get(`/v1/acme/submissions/${created.id}/revisions`)
      .expect(200);
    expect(history.body.data.map((r: { action: string }) => r.action)).toEqual([
      'update',
      'create',
    ]);
    expect(history.body.data[0].changes).toEqual([
      {
        field: 'pieces',
        before: created.data.pieces,
        after: [
          { _id: 'r1', reference: 'FLT-01', quantite: 3, prix_unitaire: 12500, montant: 37500 },
        ],
      },
      { field: 'total_pieces', before: 25000, after: 37500 },
    ]);
    expect(history.body.data[0]).toMatchObject({ clientMutationId: 'u-1' });
  });

  it('revalide la fiche complète contre sa version d origine', async () => {
    const { body } = await technicien.post(url).send({ data: valid() }).expect(201);
    const res = await technicien
      .patch(`/v1/acme/submissions/${body.id}`)
      .send({ data: { etat: 'inconnu' } })
      .expect(422);
    expect(res.body.details).toEqual([{ path: ['etat'], field: 'etat', code: 'option' }]);
  });

  it('reste liée à sa version après publication d une nouvelle version', async () => {
    const { body: old } = await technicien.post(url).send({ data: valid() }).expect(201);
    const v1 = await admin.get(`/v1/acme/structures/${tenant.structure.id}/versions/1`).expect(200);
    const definition = v1.body.definition;
    definition.fields.push({
      id: 'f-obs',
      key: 'observations',
      type: 'text',
      label: 'Obs',
      required: true,
    });
    await admin
      .put(`/v1/acme/structures/${tenant.structure.id}/draft`)
      .send({ definition })
      .expect(200);
    await admin.post(`/v1/acme/structures/${tenant.structure.id}/publish`).expect(200);

    const updated = await technicien
      .patch(`/v1/acme/submissions/${old.id}`)
      .send({ data: { description_defaut: 'Fuite colmatée' } })
      .expect(200);
    expect(updated.body.version).toBe(1);

    const fresh = await technicien.post(url).send({ data: valid() }).expect(422);
    expect(fresh.body.details).toEqual([
      { path: ['observations'], field: 'observations', code: 'required' },
    ]);
  });

  it('refuse la modification d un champ en lecture seule', async () => {
    const { body: structure } = await admin
      .post('/v1/acme/structures')
      .send({
        name: 'Verrou',
        definition: {
          schemaVersion: 1,
          fields: [
            {
              id: '1',
              key: 'ref',
              type: 'text',
              label: 'Réf',
              readOnly: true,
              defaultValue: 'R-1',
            },
            { id: '2', key: 'note', type: 'text', label: 'Note' },
          ],
        },
      })
      .expect(201);
    await admin.post(`/v1/acme/structures/${structure.id}/publish`).expect(200);
    const { body } = await technicien
      .post(`/v1/acme/structures/${structure.id}/submissions`)
      .send({ data: { note: 'a' } })
      .expect(201);
    expect(body.data.ref).toBe('R-1');
    const res = await technicien
      .patch(`/v1/acme/submissions/${body.id}`)
      .send({ data: { ref: 'R-2', note: 'b' } })
      .expect(422);
    expect(res.body.details).toEqual([{ path: ['ref'], field: 'ref', code: 'read_only' }]);
    await technicien
      .patch(`/v1/acme/submissions/${body.id}`)
      .send({ data: { ref: 'R-1', note: 'b' } })
      .expect(200);
  });

  it('supprime logiquement, de façon idempotente, et trace la suppression', async () => {
    const { body } = await technicien.post(url).send({ data: valid() }).expect(201);
    await technicien.delete(`/v1/acme/submissions/${body.id}`).expect(403); // technicien : pas submission:delete
    await superviseur.delete(`/v1/acme/submissions/${body.id}?client_mutation_id=d-1`).expect(204);
    await superviseur.delete(`/v1/acme/submissions/${body.id}?client_mutation_id=d-1`).expect(204);
    await superviseur.get(`/v1/acme/submissions/${body.id}`).expect(404);
    await superviseur.delete(`/v1/acme/submissions/${body.id}`).expect(404);
    expect((await admin.get(url).expect(200)).body.meta.total).toBe(0);
  });
});

describe('lecture : périmètre, filtres, tri', () => {
  beforeEach(async () => {
    await technicien
      .post(url)
      .send({ data: { ...valid(), etat: 'bon', date_inspection: '2026-10-01' } })
      .expect(201);
    await technicien
      .post(url)
      .send({ data: { ...valid(), date_inspection: '2026-10-10' } })
      .expect(201);
    await superviseur
      .post(url)
      .send({
        data: {
          ...valid(),
          equipement: items['EQ-0002'],
          etat: 'hors_service',
          date_inspection: '2026-10-15',
        },
      })
      .expect(201);
  });

  it('limite le technicien à ses propres fiches', async () => {
    expect((await technicien.get(url).expect(200)).body.meta.total).toBe(2);
    expect((await superviseur.get(url).expect(200)).body.meta.total).toBe(3);
    const others = (await superviseur.get(`${url}?filter[etat]=hors_service`).expect(200)).body
      .data;
    await technicien.get(`/v1/acme/submissions/${others[0].id}`).expect(404);
    await technicien.patch(`/v1/acme/submissions/${others[0].id}`).send({ data: {} }).expect(404);
  });

  it('filtre sur les champs filtrables et trie', async () => {
    const etat = await admin.get(`${url}?filter[etat]=degrade`).expect(200);
    expect(etat.body.meta.total).toBe(1);

    const range = await admin
      .get(`${url}?filter[date_inspection][gte]=2026-10-05&sort=-date_inspection`)
      .expect(200);
    expect(
      range.body.data.map((s: { data: { date_inspection: string } }) => s.data.date_inspection),
    ).toEqual(['2026-10-15', '2026-10-10']);

    const inList = await admin
      .get(`${url}?filter[etat][in]=bon,hors_service&sort=date_inspection`)
      .expect(200);
    expect(inList.body.data.map((s: { data: { etat: string } }) => s.data.etat)).toEqual([
      'bon',
      'hors_service',
    ]);

    const author = await admin.get(`${url}?author_id=${tenant.users[1]!.id}`).expect(200);
    expect(author.body.meta.total).toBe(1);

    const page = await admin.get(`${url}?per_page=2&page=2&sort=createdAt`).expect(200);
    expect(page.body.meta).toEqual({ page: 2, perPage: 2, total: 3, totalPages: 2 });
    expect(page.body.data).toHaveLength(1);
  });

  it('refuse un filtre ou un tri sur un champ non filtrable', async () => {
    const res = await admin.get(`${url}?filter[description_defaut]=x`).expect(400);
    expect(res.body.error).toBe('invalid_filter');
    await admin.get(`${url}?sort=photos`).expect(400);
    await admin.get(`${url}?filter[etat][like]=x`).expect(400);
  });
});
