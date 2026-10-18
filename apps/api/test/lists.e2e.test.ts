import { type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readSpreadsheet } from '../src/lists/spreadsheet';
import { api, createTenant, createTestApp, login, resetDatabase } from './helpers';

let app: INestApplication;
let admin: ReturnType<typeof api>;
let technicien: ReturnType<typeof api>;
let listId: string;

const CSV = [
  'Site code;Site;Bâtiment;Équipement code;Équipement;Équipement.marque',
  'S1;Plateau;Tour A;EQ-1;Groupe électrogène;SDMO',
  'S1;Plateau;Tour A;EQ-2;Climatiseur;',
  'S2;Yopougon;Entrepôt 3;EQ-3;Transformateur;Schneider',
].join('\n');

const upload = (csv: string, fields: Record<string, string> = {}) => {
  let req = admin
    .post(`/v1/acme/lists/${listId}/import`)
    .attach('file', Buffer.from(csv), 'import.csv');
  for (const [name, value] of Object.entries(fields)) req = req.field(name, value);
  return req;
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
  technicien = api(app, (await login(app, 'technicien@acme.test')).access_token);
  const { body } = await admin
    .post('/v1/acme/lists')
    .send({ name: 'Équipements', levels: ['Site', 'Bâtiment', 'Équipement'] })
    .expect(201);
  listId = body.id;
});

describe('éléments', () => {
  it('construit une hiérarchie, filtre en cascade et recherche', async () => {
    const site = await admin
      .post(`/v1/acme/lists/${listId}/items`)
      .send({ label: 'Plateau', code: 'S1' })
      .expect(201);
    const batiment = await admin
      .post(`/v1/acme/lists/${listId}/items`)
      .send({ label: 'Tour A', parentId: site.body.id })
      .expect(201);
    const equipement = await admin
      .post(`/v1/acme/lists/${listId}/items`)
      .send({
        label: 'Groupe',
        code: 'EQ-1',
        parentId: batiment.body.id,
        attributes: { marque: 'SDMO' },
      })
      .expect(201);
    expect(equipement.body).toMatchObject({ level: 2, attributes: { marque: 'SDMO' } });

    await admin
      .post(`/v1/acme/lists/${listId}/items`)
      .send({ label: 'Trop profond', parentId: equipement.body.id })
      .expect(400);
    await admin
      .post(`/v1/acme/lists/${listId}/items`)
      .send({ label: 'Doublon', code: 'S1' })
      .expect(409);

    const roots = await technicien.get(`/v1/acme/lists/${listId}/items?parent_id=root`).expect(200);
    expect(roots.body.data.map((i: { label: string }) => i.label)).toEqual(['Plateau']);
    const children = await technicien
      .get(`/v1/acme/lists/${listId}/items?parent_id=${site.body.id}`)
      .expect(200);
    expect(children.body.data.map((i: { label: string }) => i.label)).toEqual(['Tour A']);
    const search = await technicien
      .get(`/v1/acme/lists/${listId}/items?q=grou&level=2`)
      .expect(200);
    expect(search.body.meta.total).toBe(1);

    const lookup = await technicien.get('/v1/acme/list-items?code=EQ-1').expect(200);
    expect(lookup.body.data).toHaveLength(1);
    expect(lookup.body.data[0]).toMatchObject({ label: 'Groupe', list: { name: 'Équipements' } });
  });

  it('archive un élément et sa descendance, puis le restaure', async () => {
    const site = await admin
      .post(`/v1/acme/lists/${listId}/items`)
      .send({ label: 'Plateau' })
      .expect(201);
    await admin
      .post(`/v1/acme/lists/${listId}/items`)
      .send({ label: 'Tour A', parentId: site.body.id })
      .expect(201);
    await admin.delete(`/v1/acme/lists/${listId}/items/${site.body.id}`).expect(204);
    expect((await admin.get(`/v1/acme/lists/${listId}/items`).expect(200)).body.meta.total).toBe(0);
    expect(
      (await admin.get(`/v1/acme/lists/${listId}/items?include_archived=true`).expect(200)).body
        .meta.total,
    ).toBe(2);
    await admin
      .patch(`/v1/acme/lists/${listId}/items/${site.body.id}`)
      .send({ archived: false })
      .expect(200);
    expect((await admin.get(`/v1/acme/lists/${listId}/items`).expect(200)).body.meta.total).toBe(1);
  });

  it('refuse les écritures au technicien', async () => {
    await technicien
      .post('/v1/acme/lists')
      .send({ name: 'X', levels: ['A'] })
      .expect(403);
    await technicien.post(`/v1/acme/lists/${listId}/items`).send({ label: 'X' }).expect(403);
    await technicien.post(`/v1/acme/lists/${listId}/import`).expect(403);
  });
});

describe('import', () => {
  it('prévisualise sans rien écrire, puis applique', async () => {
    const preview = await upload(CSV, { dry_run: 'true' }).expect(200);
    expect(preview.body).toMatchObject({
      dryRun: true,
      applied: false,
      rows: 3,
      created: 7,
      errors: [],
    });
    expect((await admin.get(`/v1/acme/lists/${listId}/items`).expect(200)).body.meta.total).toBe(0);

    const applied = await upload(CSV).expect(200);
    expect(applied.body).toMatchObject({ applied: true, created: 7 });
    const items = await admin.get(`/v1/acme/lists/${listId}/items?code=EQ-1`).expect(200);
    expect(items.body.data[0]).toMatchObject({ level: 2, attributes: { marque: 'SDMO' } });

    const again = await upload(CSV).expect(200);
    expect(again.body).toMatchObject({ created: 0, updated: 0, unchanged: 7 });
  });

  it('remplace : archive les éléments absents du fichier', async () => {
    await upload(CSV).expect(200);
    const replaced = await upload(CSV.split('\n').slice(0, 3).join('\n'), {
      mode: 'replace',
    }).expect(200);
    expect(replaced.body).toMatchObject({ archived: 3, created: 0 });
    expect((await admin.get(`/v1/acme/lists/${listId}/items`).expect(200)).body.meta.total).toBe(4);
  });

  it('n applique rien si une ligne est en erreur et rapporte les lignes fautives', async () => {
    const res = await upload(`${CSV}\n;;Bâtiment orphelin;;;`).expect(200);
    expect(res.body).toMatchObject({
      applied: false,
      errors: [{ row: 5, message: 'Site : libellé manquant' }],
    });
    expect((await admin.get(`/v1/acme/lists/${listId}/items`).expect(200)).body.meta.total).toBe(0);
  });

  it('accepte une correspondance de colonnes explicite', async () => {
    const res = await upload('Nom du site;Réf\nPlateau;P-1', {
      mapping: JSON.stringify([{ label: 'Nom du site', code: 'Réf' }]),
    }).expect(200);
    expect(res.body).toMatchObject({ applied: true, created: 1 });
    await upload('a', { mapping: '{pas du json' }).expect(400);
  });

  it('refuse un fichier absent', async () => {
    await admin.post(`/v1/acme/lists/${listId}/import`).expect(400);
  });
});

describe('export', () => {
  it.each(['csv', 'xlsx'] as const)('exporte en %s un fichier réimportable', async (format) => {
    await upload(CSV).expect(200);
    const res = await technicien
      .get(`/v1/acme/lists/${listId}/export?format=${format}`)
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-disposition']).toContain(`.${format}`);
    const table = await readSpreadsheet(res.body as Buffer);
    expect(table.rows).toHaveLength(3);
    expect(table.headers).toContain('Équipement.marque');
  });
});

describe('référentiels', () => {
  it('liste, renomme et supprime', async () => {
    await upload(CSV).expect(200);
    const list = await admin.get('/v1/acme/lists').expect(200);
    expect(list.body.data[0]).toMatchObject({ name: 'Équipements', itemCount: 7 });
    await admin
      .patch(`/v1/acme/lists/${listId}`)
      .send({ levels: ['Site'] })
      .expect(400);
    await admin.patch(`/v1/acme/lists/${listId}`).send({ name: 'Parc' }).expect(200);
    await admin.delete(`/v1/acme/lists/${listId}`).expect(204);
    await admin.get(`/v1/acme/lists/${listId}`).expect(404);
  });
});
