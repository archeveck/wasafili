import { type INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildDocx, paragraph, solidPng } from '../src/reports/build-docx';
import { demoReportDocx } from '../src/reports/demo-template';
import { api, createDemoTenant, createTestApp, demoItems, login, resetDatabase } from './helpers';

let app: INestApplication;
let tenant: Awaited<ReturnType<typeof createDemoTenant>>;
let admin: ReturnType<typeof api>;
let technicien: ReturnType<typeof api>;
let structureId: string;

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Téléverse un fichier par le flux normal (URL signée puis confirmation). */
async function upload(
  client: ReturnType<typeof api>,
  body: Buffer,
  name: string,
  mimeType: string,
) {
  const id = randomUUID();
  const res = await client
    .post('/v1/acme/files/upload')
    .send({ id, name, mimeType, size: body.length })
    .expect(201);
  const put = await fetch(res.body.upload.url, {
    method: 'PUT',
    headers: res.body.upload.headers,
    body: new Uint8Array(body),
  });
  expect(put.ok).toBe(true);
  await client.post(`/v1/acme/files/${id}/complete`).expect(200);
  return id;
}

async function pdfOf(url: string) {
  const res = await fetch(url);
  expect(res.ok).toBe(true);
  return Buffer.from(await res.arrayBuffer());
}

beforeAll(async () => {
  app = await createTestApp({
    GOTENBERG_URL: process.env['GOTENBERG_URL'] ?? 'http://localhost:3001',
  });
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase();
  tenant = await createDemoTenant('acme');
  structureId = tenant.structure.id;
  admin = api(app, (await login(app, 'admin@acme.test')).access_token);
  technicien = api(app, (await login(app, 'technicien@acme.test')).access_token);
});

describe('rapports', () => {
  it('enregistre un modèle, en détecte les balises et signale celles inconnues', async () => {
    const fileId = await upload(
      admin,
      buildDocx(paragraph('{{equipement}} {{inconnu}} {{photos}} {{#etat}}x{{/etat}}')),
      'modele.docx',
      DOCX,
    );
    const created = await admin
      .post(`/v1/acme/structures/${structureId}/reports`)
      .send({ name: 'Brouillon', fileId })
      .expect(201);
    expect(created.body.tags).toContainEqual({ name: 'equipement', kind: 'value' });
    expect(created.body.issues).toEqual([
      { tag: '{{inconnu}}', message: 'Champ inconnu dans ce formulaire' },
      { tag: '{{photos}}', message: 'Pour afficher « Photos », utilisez {{@photos}}' },
      { tag: '{{#etat}}', message: "« État général » n'est pas un tableau répétable" },
    ]);
    const tags = await admin.get(`/v1/acme/structures/${structureId}/reports/tags`).expect(200);
    expect(tags.body.fields).toContainEqual({ tag: '{{@signature}}', label: 'Signature' });

    // Réservé à la gestion des rapports ; la liste reste lisible par les techniciens.
    await technicien
      .post(`/v1/acme/structures/${structureId}/reports`)
      .send({ name: 'x', fileId })
      .expect(403);
    const list = await technicien.get(`/v1/acme/structures/${structureId}/reports`).expect(200);
    expect(list.body.data).toHaveLength(1);
  });

  it('refuse un modèle mal formé avec une explication', async () => {
    const fileId = await upload(
      admin,
      buildDocx(paragraph('{{#pieces}} sans fin')),
      'casse.docx',
      DOCX,
    );
    const res = await admin
      .post(`/v1/acme/structures/${structureId}/reports`)
      .send({ name: 'Cassé', fileId })
      .expect(422);
    expect(res.body).toMatchObject({ error: 'invalid_template' });
    expect(res.body.message).toMatch(/boucle « \{\{#pieces\}\} » n'est pas fermée/);

    const text = await upload(admin, Buffer.from('bonjour'), 'notes.txt', 'text/plain');
    await admin
      .post(`/v1/acme/structures/${structureId}/reports`)
      .send({ name: 'Texte', fileId: text })
      .expect(422);
  });

  it('génère le PDF d’une fiche (images comprises), le met en cache par révision', async () => {
    const items = await demoItems(tenant.instance.id);
    const fileId = await upload(admin, demoReportDocx(), 'inspection.docx', DOCX);
    const report = await admin
      .post(`/v1/acme/structures/${structureId}/reports`)
      .send({ name: 'Rapport', fileId, filename: 'Inspection {{equipement}}' })
      .expect(201);
    expect(report.body.issues).toEqual([]);

    const signature = await upload(
      technicien,
      solidPng(200, 80, [20, 20, 20]),
      'signature.png',
      'image/png',
    );
    const fiche = await technicien
      .post(`/v1/acme/structures/${structureId}/submissions`)
      .send({
        data: {
          site: items['S-PLT'],
          batiment: items['B-PLT-A'],
          equipement: items['EQ-0003'],
          date_inspection: '2026-10-18',
          etat: 'degrade',
          description_defaut: 'Câble usé',
          photos: [{ fileId: signature }],
          pieces: [{ _id: 'l1', reference: 'CAB-12', quantite: 2, prix_unitaire: 1500 }],
          signature: { fileId: signature },
        },
      })
      .expect(201);
    const submissionId = fiche.body.id as string;

    const first = await technicien
      .post(`/v1/acme/reports/${report.body.id}/render`)
      .send({ submissionId })
      .expect(201);
    expect(first.body).toMatchObject({ cached: false });
    expect(first.body.filename).toMatch(/^Inspection .+\.pdf$/);
    const pdf = await pdfOf(first.body.url);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1')).toMatch(/\/Subtype\s*\/Image/);

    const again = await technicien
      .post(`/v1/acme/reports/${report.body.id}/render`)
      .send({ submissionId })
      .expect(201);
    expect(again.body.cached).toBe(true);

    // Nouvelle révision : nouveau PDF.
    await technicien
      .patch(`/v1/acme/submissions/${submissionId}`)
      .send({ data: { description_defaut: 'Câble remplacé' } })
      .expect(200);
    const updated = await technicien
      .post(`/v1/acme/reports/${report.body.id}/render`)
      .send({ submissionId })
      .expect(201);
    expect(updated.body.cached).toBe(false);

    // Aperçu sur une fiche d'exemple : gestion des rapports uniquement.
    const preview = await admin
      .post(`/v1/acme/reports/${report.body.id}/render`)
      .send({})
      .expect(201);
    expect((await pdfOf(preview.body.url)).subarray(0, 5).toString()).toBe('%PDF-');
    await technicien.post(`/v1/acme/reports/${report.body.id}/render`).send({}).expect(403);
  });

  it('ne génère pas le rapport d’une fiche invisible pour l’appelant', async () => {
    const fileId = await upload(admin, demoReportDocx(), 'inspection.docx', DOCX);
    const report = await admin
      .post(`/v1/acme/structures/${structureId}/reports`)
      .send({ name: 'Rapport', fileId })
      .expect(201);
    const items = await demoItems(tenant.instance.id);
    const signature = await upload(admin, solidPng(20, 10, [0, 0, 0]), 's.png', 'image/png');
    const fiche = await admin
      .post(`/v1/acme/structures/${structureId}/submissions`)
      .send({
        data: {
          site: items['S-PLT'],
          batiment: items['B-PLT-A'],
          equipement: items['EQ-0003'],
          etat: 'bon',
          signature: { fileId: signature },
        },
      })
      .expect(201);
    // Le technicien ne lit que ses fiches.
    await technicien
      .post(`/v1/acme/reports/${report.body.id}/render`)
      .send({ submissionId: fiche.body.id })
      .expect(404);
  });
});
