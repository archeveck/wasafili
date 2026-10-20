import { type INestApplication } from '@nestjs/common';
import { inspectionWorkflow } from '@wasafili/form-schema';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createTenant, createTestApp, login, resetDatabase } from './helpers';

let app: INestApplication;
let admin: ReturnType<typeof api>;
let superviseur: ReturnType<typeof api>;
let technicien: ReturnType<typeof api>;
let structureId: string;

const workflow = {
  ...inspectionWorkflow,
  transitions: inspectionWorkflow.transitions.map((t) =>
    t.key === 'rejeter' ? { ...t, requiredFields: ['motif'] } : t,
  ),
};
const definition = {
  schemaVersion: 1,
  workflow,
  fields: [
    {
      id: 'f-nom',
      key: 'nom',
      type: 'text',
      label: 'Nom',
      required: true,
      editableInStates: ['brouillon', 'rejete'],
    },
    {
      id: 'f-motif',
      key: 'motif',
      type: 'text',
      label: 'Motif',
      visibleInStates: ['soumis', 'rejete'],
    },
  ],
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
  admin = api(app, (await login(app, 'admin@acme.test')).access_token);
  superviseur = api(app, (await login(app, 'superviseur@acme.test')).access_token);
  technicien = api(app, (await login(app, 'technicien@acme.test')).access_token);
  const { body } = await admin.post('/v1/acme/structures').send({ name: 'Contrôle' }).expect(201);
  structureId = body.id as string;
  await admin.put(`/v1/acme/structures/${structureId}/draft`).send({ definition }).expect(200);
  await admin.post(`/v1/acme/structures/${structureId}/publish`).expect(200);
});

const create = async () =>
  (
    await technicien
      .post(`/v1/acme/structures/${structureId}/submissions`)
      .send({ data: { nom: 'Pompe' } })
      .expect(201)
  ).body as { id: string; state: string };

const transition = (client: ReturnType<typeof api>, id: string, body: Record<string, unknown>) =>
  client.post(`/v1/acme/submissions/${id}/transition`).send(body);

describe('transitions', () => {
  it("part de l'état initial, applique les rôles et trace l'historique", async () => {
    const fiche = await create();
    expect(fiche.state).toBe('brouillon');

    const submitted = await transition(technicien, fiche.id, { transition: 'soumettre' }).expect(
      200,
    );
    expect(submitted.body).toMatchObject({ state: 'soumis', revision: 2 });

    const refused = await transition(technicien, fiche.id, { transition: 'valider' }).expect(403);
    expect(refused.body.message).toBe('Votre rôle ne permet pas « Valider »');
    await transition(superviseur, fiche.id, { transition: 'valider' }).expect(200);

    const late = await transition(technicien, fiche.id, { transition: 'soumettre' }).expect(409);
    expect(late.body).toMatchObject({
      error: 'invalid_state',
      message: 'La fiche est à l’état « Validé » : « Soumettre » n’est plus possible',
    });
    await transition(admin, fiche.id, { transition: 'inconnue' }).expect(422);

    const { body: history } = await admin.get(`/v1/acme/submissions/${fiche.id}/revisions`);
    expect(history.data.map((r: { action: string }) => r.action)).toEqual([
      'transition',
      'transition',
      'create',
    ]);
    expect(history.data[0].changes).toEqual([
      { field: '$state', before: 'soumis', after: 'valide' },
    ]);
  });

  it('exige les champs de la transition et enregistre les données fournies', async () => {
    const fiche = await create();
    await transition(technicien, fiche.id, { transition: 'soumettre' }).expect(200);

    const missing = await transition(superviseur, fiche.id, { transition: 'rejeter' }).expect(422);
    expect(missing.body.details).toEqual([
      { path: ['motif'], field: 'motif', code: 'required', params: { transition: 'rejeter' } },
    ]);
    const rejected = await transition(superviseur, fiche.id, {
      transition: 'rejeter',
      data: { motif: 'Photo floue' },
    }).expect(200);
    expect(rejected.body).toMatchObject({
      state: 'rejete',
      data: { nom: 'Pompe', motif: 'Photo floue' },
    });
    const { body: history } = await admin.get(`/v1/acme/submissions/${fiche.id}/revisions`);
    expect(history.data[0].changes).toEqual([
      { field: 'motif', before: null, after: 'Photo floue' },
      { field: '$state', before: 'soumis', after: 'rejete' },
    ]);
  });

  it('applique la lecture seule par état', async () => {
    const fiche = await create();
    await transition(technicien, fiche.id, { transition: 'soumettre' }).expect(200);
    const res = await technicien
      .patch(`/v1/acme/submissions/${fiche.id}`)
      .send({ data: { nom: 'Autre' } })
      .expect(422);
    expect(res.body.details).toEqual([{ path: ['nom'], field: 'nom', code: 'read_only' }]);
  });

  it('compte les fiches par état', async () => {
    const a = await create();
    await create();
    await transition(technicien, a.id, { transition: 'soumettre' }).expect(200);
    const { body } = await admin
      .get(`/v1/acme/structures/${structureId}/submissions/states`)
      .expect(200);
    expect(body.data).toEqual([
      { state: 'brouillon', count: 1 },
      { state: 'soumis', count: 1 },
    ]);
    const list = `/v1/acme/structures/${structureId}/submissions`;
    const soon = new Date(Date.now() + 60_000).toISOString();
    expect((await admin.get(list).query({ state: 'soumis' })).body.meta.total).toBe(1);
    expect((await admin.get(list).query({ created_to: soon })).body.meta.total).toBe(2);
    expect((await admin.get(list).query({ created_from: soon })).body.meta.total).toBe(0);
  });
});

describe('transitions hors ligne', () => {
  it('rejoue sans effet et explique un refus', async () => {
    const fiche = await create();
    const mutation = {
      id: randomUUID(),
      type: 'transition',
      submissionId: fiche.id,
      transition: 'soumettre',
      baseRevision: 1,
    };
    const first = await technicien
      .post('/v1/acme/sync/push')
      .send({ mutations: [mutation] })
      .expect(200);
    expect(first.body.results[0]).toMatchObject({
      status: 'applied',
      submission: { state: 'soumis' },
    });
    const again = await technicien
      .post('/v1/acme/sync/push')
      .send({ mutations: [mutation] })
      .expect(200);
    expect(again.body.results[0]).toMatchObject({
      status: 'duplicate',
      submission: { revision: 2 },
    });

    const stale = await technicien
      .post('/v1/acme/sync/push')
      .send({ mutations: [{ ...mutation, id: randomUUID() }] })
      .expect(200);
    expect(stale.body.results[0]).toMatchObject({
      status: 'rejected',
      error: {
        status: 409,
        code: 'invalid_state',
        message: 'La fiche est à l’état « Soumis » : « Soumettre » n’est plus possible',
      },
    });
  });
});
