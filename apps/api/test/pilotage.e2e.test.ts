import { type INestApplication } from '@nestjs/common';
import { inspectionWorkflow } from '@tesserax/form-schema';
import { QUEUE_NAME } from '@tesserax/jobs';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { tenantTransaction } from '../src/prisma/tenant';
import {
  api,
  createTenant,
  createTestApp,
  login,
  owner,
  resetDatabase,
  TEST_QUEUE_PREFIX,
} from './helpers';

/**
 * Pilotage (Phase 6) : carte des fiches, suivi des équipes, tableaux de bord et export ZIP
 * des photos. Tous s'appuient sur la sélection de fiches de la liste (droits, visibilité).
 */
let app: INestApplication;
let tenant: Awaited<ReturnType<typeof createTenant>>;
let admin: ReturnType<typeof api>;
let technicien: ReturnType<typeof api>;
let structureId: string;

const definition = {
  schemaVersion: 1,
  workflow: inspectionWorkflow,
  fields: [
    { id: 'f-nom', key: 'nom', type: 'text', label: 'Nom', filterable: true },
    {
      id: 'f-cat',
      key: 'categorie',
      type: 'select',
      label: 'Catégorie',
      filterable: true,
      options: [
        { value: 'pompe', label: 'Pompe' },
        { value: 'vanne', label: 'Vanne' },
      ],
    },
    { id: 'f-mesure', key: 'mesure', type: 'number', label: 'Mesure', filterable: true },
    { id: 'f-pos', key: 'position', type: 'geolocation', label: 'Position' },
    { id: 'f-photos', key: 'photos', type: 'photo', label: 'Photos' },
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
  tenant = await createTenant('acme');
  await createTenant('beta');
  admin = api(app, (await login(app, 'admin@acme.test')).access_token);
  technicien = api(app, (await login(app, 'technicien@acme.test')).access_token);
  const { body } = await admin.post('/v1/acme/structures').send({ name: 'Contrôle' }).expect(201);
  structureId = body.id as string;
  await admin.put(`/v1/acme/structures/${structureId}/draft`).send({ definition }).expect(200);
  await admin.post(`/v1/acme/structures/${structureId}/publish`).expect(200);
});

const create = (client: ReturnType<typeof api>, data: Record<string, unknown>, location?: object) =>
  client
    .post(`/v1/acme/structures/${structureId}/submissions`)
    .send({ data, ...(location ? { location } : {}) })
    .expect(201)
    .then((res) => res.body as { id: string });

const geo = (lat: number, lng: number) => ({ lat, lng, source: 'manual' });

describe('carte des fiches (P6.1.1)', () => {
  it('renvoie les fiches localisées en GeoJSON, avec les filtres de la liste', async () => {
    const champ = await create(admin, {
      nom: 'Pompe A',
      categorie: 'pompe',
      position: geo(5.3, -4.0),
    });
    const appareil = await create(
      admin,
      { nom: 'Vanne B', categorie: 'vanne' },
      { lat: 7.7, lng: -5.0 },
    );
    await create(admin, { nom: 'Sans position', categorie: 'pompe' });

    const all = await admin.get(`/v1/acme/structures/${structureId}/submissions/map`).expect(200);
    expect(all.body.type).toBe('FeatureCollection');
    expect(all.body.meta).toEqual({ count: 2, truncated: false });
    const byId = new Map(all.body.features.map((f: { id: string }) => [f.id, f]));
    // Le champ géolocalisation prime sur la position de l'appareil.
    expect(byId.get(champ.id)).toMatchObject({
      geometry: { type: 'Point', coordinates: [-4.0, 5.3] },
      properties: { label: 'Pompe A', state: 'brouillon' },
    });
    expect(byId.get(appareil.id)).toMatchObject({ geometry: { coordinates: [-5.0, 7.7] } });

    const filtered = await admin
      .get(`/v1/acme/structures/${structureId}/submissions/map?filter[categorie]=vanne`)
      .expect(200);
    expect(filtered.body.features.map((f: { id: string }) => f.id)).toEqual([appareil.id]);
  });

  it('respecte le périmètre de lecture (technicien : ses fiches)', async () => {
    await create(admin, { nom: 'Admin', position: geo(5, -4) });
    const own = await create(technicien, { nom: 'Moi', position: geo(6, -4) });
    const res = await technicien
      .get(`/v1/acme/structures/${structureId}/submissions/map`)
      .expect(200);
    expect(res.body.features.map((f: { id: string }) => f.id)).toEqual([own.id]);
  });
});

describe('suivi des équipes (P6.1.2)', () => {
  it('donne la dernière position connue de chaque membre', async () => {
    await create(technicien, { nom: 'Ancienne' }, { lat: 5.1, lng: -4.1 });
    const latest = await create(technicien, { nom: 'Récente' }, { lat: 5.2, lng: -4.2 });
    // Une position saisie dans un champ ne dit pas où se trouvait l'agent.
    await create(admin, { nom: 'Champ seul', position: geo(9, -9) });

    const res = await admin.get('/v1/acme/team/positions').expect(200);
    expect(res.body.data).toEqual([
      expect.objectContaining({
        user: expect.objectContaining({ email: 'technicien@acme.test' }),
        lat: 5.2,
        lng: -4.2,
        source: 'submission',
        sourceId: latest.id,
      }),
    ]);
    await technicien.get('/v1/acme/team/positions').expect(403);
    const beta = api(app, (await login(app, 'admin@beta.test')).access_token);
    expect((await beta.get('/v1/beta/team/positions').expect(200)).body.data).toEqual([]);
  });
});

describe('tableaux de bord (P6.2)', () => {
  const widget = (overrides: Record<string, unknown>) => ({
    id: 'w1',
    type: 'kpi',
    title: 'Fiches',
    structureId,
    metric: { op: 'count' },
    period: '30d',
    ...overrides,
  });

  beforeEach(async () => {
    await create(admin, { nom: 'A', categorie: 'pompe', mesure: 10 });
    await create(admin, { nom: 'B', categorie: 'pompe', mesure: 20 });
    await create(admin, { nom: 'C', categorie: 'vanne', mesure: 60 });
    await create(technicien, { nom: 'D', categorie: 'vanne' });
  });

  const data = (client: ReturnType<typeof api>, body: object, status = 200) =>
    client.post('/v1/acme/dashboards/widget-data').send(body).expect(status);

  it('calcule indicateurs et graphiques sur les fiches visibles de l appelant', async () => {
    expect((await data(admin, widget({}))).body).toEqual({ type: 'kpi', value: 4, count: 4 });
    expect((await data(technicien, widget({}))).body).toMatchObject({ value: 1 });
    expect((await data(admin, widget({ metric: { op: 'avg', field: 'mesure' } }))).body.value).toBe(
      30,
    );
    expect(
      (
        await data(
          admin,
          widget({ filters: [{ key: 'categorie', operator: 'eq', value: 'pompe' }] }),
        )
      ).body.value,
    ).toBe(2);

    const bars = await data(
      admin,
      widget({ type: 'bar', groupBy: { kind: 'field', field: 'categorie' } }),
    );
    expect(bars.body.series).toEqual([
      { key: 'pompe', label: 'Pompe', value: 2 },
      { key: 'vanne', label: 'Vanne', value: 2 },
    ]);
    const states = await data(admin, widget({ type: 'bar', groupBy: { kind: 'state' } }));
    expect(states.body.series).toEqual([{ key: 'brouillon', label: 'Brouillon', value: 4 }]);
    const authors = await data(admin, widget({ type: 'bar', groupBy: { kind: 'author' } }));
    expect(authors.body.series.map((p: { label: string }) => p.label)).toEqual([
      'admin acme',
      'technicien acme',
    ]);

    const line = await data(
      admin,
      widget({ type: 'line', groupBy: { kind: 'period', unit: 'day' }, period: '7d' }),
    );
    expect(line.body.series.length).toBeGreaterThanOrEqual(7);
    expect(line.body.series.at(-1).value).toBe(4);
    expect(line.body.series[0].value).toBe(0);
  });

  it('refuse un widget incohérent ou un champ non agrégeable', async () => {
    const invalid = await data(admin, widget({ type: 'line' }), 400);
    expect(JSON.stringify(invalid.body.details)).toContain('par période');
    await data(admin, widget({ metric: { op: 'sum', field: 'nom' } }), 422);
    await data(admin, widget({ type: 'bar', groupBy: { kind: 'field', field: 'mesure' } }), 422);
  });

  it('enregistre un tableau de bord (dashboard:manage), consultable par tous', async () => {
    const created = await admin
      .post('/v1/acme/dashboards')
      .send({ name: 'Suivi', widgets: [widget({}), widget({ id: 'w2', width: 2 })] })
      .expect(201);
    expect(created.body.widgets[1]).toMatchObject({ width: 2, filters: [] });
    await technicien.post('/v1/acme/dashboards').send({ name: 'X' }).expect(403);
    expect((await technicien.get('/v1/acme/dashboards').expect(200)).body.data).toHaveLength(1);
    await admin
      .put(`/v1/acme/dashboards/${created.body.id}`)
      .send({ name: 'Suivi', widgets: [widget({}), widget({})] })
      .expect(400);
    await admin.delete(`/v1/acme/dashboards/${created.body.id}`).expect(204);
    const audit = await admin.get('/v1/acme/audit-logs?action=dashboard.').expect(200);
    expect(audit.body.data.map((e: { action: string }) => e.action)).toEqual([
      'dashboard.delete',
      'dashboard.create',
    ]);
  });
});

describe('export ZIP des photos (P6.4)', () => {
  const file = async (status: 'uploaded' | 'pending', name: string) => {
    const id = randomUUID();
    await tenantTransaction(owner(), { instanceId: tenant.instance.id }, (tx) =>
      tx.file.create({
        data: {
          id,
          instanceId: tenant.instance.id,
          key: `${tenant.instance.id}/${id}`,
          name,
          mimeType: 'image/jpeg',
          size: 10,
          status,
        },
      }),
    );
    return id;
  };

  it('prépare l archive : chemins nommés, photos annotées, job pour le worker', async () => {
    const [a, annotated, b, pending] = await Promise.all([
      file('uploaded', 'IMG_1.jpg'),
      file('uploaded', 'IMG_1-annot.jpg'),
      file('uploaded', 'IMG_2.jpg'),
      file('pending', 'IMG_3.jpg'),
    ]);
    await create(admin, {
      nom: 'SN/1',
      categorie: 'pompe',
      photos: [{ fileId: a, annotatedFileId: annotated }, { fileId: b }],
    });
    await create(admin, { nom: 'SN 2', categorie: 'vanne', photos: [{ fileId: pending }] });
    await create(admin, { nom: 'Sans photo', categorie: 'pompe' });

    const res = await admin
      .post(`/v1/acme/structures/${structureId}/photo-exports`)
      .send({
        pattern: '{valeur:nom}/{champ}_{n}',
        filters: [{ key: 'categorie', operator: 'eq', value: 'pompe' }],
      })
      .expect(201);
    expect(res.body).toMatchObject({ status: 'queued', fileCount: 3, missing: 0 });

    const stored = await tenantTransaction(owner(), { instanceId: tenant.instance.id }, (tx) =>
      tx.photoExport.findUniqueOrThrow({ where: { id: res.body.id } }),
    );
    expect(stored.entries).toEqual([
      { key: `${tenant.instance.id}/${a}`, name: 'SN_1/photos_1.jpg' },
      { key: `${tenant.instance.id}/${annotated}`, name: 'SN_1/photos_1-annotee.jpg' },
      { key: `${tenant.instance.id}/${b}`, name: 'SN_1/photos_2.jpg' },
    ]);
    const queue = new Queue(QUEUE_NAME, {
      connection: { url: process.env['REDIS_URL'] },
      prefix: TEST_QUEUE_PREFIX,
    });
    try {
      const job = await queue.getJob(res.body.id);
      expect(job?.name).toBe('photos-zip');
      expect(job?.data).toEqual({ instanceId: tenant.instance.id, exportId: res.body.id });
      await job?.remove();
    } finally {
      await queue.close();
    }

    // Photo jamais déposée : signalée, rien à archiver.
    const other = await admin
      .post(`/v1/acme/structures/${structureId}/photo-exports`)
      .send({ filters: [{ key: 'categorie', operator: 'eq', value: 'vanne' }] })
      .expect(201);
    expect(other.body).toMatchObject({ status: 'failed', fileCount: 0, missing: 1 });
  });

  it('exige le droit d export et un modèle valide ; l export n appartient qu à son demandeur', async () => {
    await technicien.post(`/v1/acme/structures/${structureId}/photo-exports`).send({}).expect(403);
    const invalid = await admin
      .post(`/v1/acme/structures/${structureId}/photo-exports`)
      .send({ pattern: '{inconnu}' })
      .expect(422);
    expect(invalid.body.error).toBe('invalid_pattern');

    const id = await file('uploaded', 'x.jpg');
    await create(admin, { nom: 'X', photos: [{ fileId: id }] });
    const created = await admin
      .post(`/v1/acme/structures/${structureId}/photo-exports`)
      .send({})
      .expect(201);
    const superviseur = api(app, (await login(app, 'superviseur@acme.test')).access_token);
    await superviseur.get(`/v1/acme/photo-exports/${created.body.id}`).expect(403);
    expect((await superviseur.get('/v1/acme/photo-exports').expect(200)).body.data).toEqual([]);
    // Archive pas encore écrite par le worker.
    await admin.post(`/v1/acme/photo-exports/${created.body.id}/download`).expect(422);

    // Archive prête, puis expirée.
    const key = `${tenant.instance.id}/exports/${created.body.id}.zip`;
    await tenantTransaction(owner(), { instanceId: tenant.instance.id }, (tx) =>
      tx.photoExport.update({ where: { id: created.body.id }, data: { status: 'succeeded', key } }),
    );
    const link = await admin.post(`/v1/acme/photo-exports/${created.body.id}/download`).expect(201);
    expect(new URL(link.body.url).searchParams.get('response-content-disposition')).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent('Contrôle - photos.zip')}`,
    );
    await tenantTransaction(owner(), { instanceId: tenant.instance.id }, (tx) =>
      tx.photoExport.update({ where: { id: created.body.id }, data: { expiresAt: new Date() } }),
    );
    await admin.post(`/v1/acme/photo-exports/${created.body.id}/download`).expect(410);
  });
});
