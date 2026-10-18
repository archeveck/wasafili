import { type INestApplication } from '@nestjs/common';
import { QUEUE_NAME } from '@tesserax/jobs';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  api,
  createDemoTenant,
  createTestApp,
  login,
  resetDatabase,
  TEST_QUEUE_PREFIX,
} from './helpers';

let app: INestApplication;
let tenant: Awaited<ReturnType<typeof createDemoTenant>>;
let admin: ReturnType<typeof api>;
let technicien: ReturnType<typeof api>;
let queue: Queue;

// PNG 1×1 valide.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

beforeAll(async () => {
  app = await createTestApp();
  queue = new Queue(QUEUE_NAME, {
    connection: { url: process.env['REDIS_URL']! },
    prefix: TEST_QUEUE_PREFIX,
  });
});

afterAll(async () => {
  await queue.close();
  await app.close();
});

beforeEach(async () => {
  await resetDatabase();
  tenant = await createDemoTenant('acme');
  admin = api(app, (await login(app, 'admin@acme.test')).access_token);
  technicien = api(app, (await login(app, 'technicien@acme.test')).access_token);
});

describe('fichiers', () => {
  it('dépôt direct par URL signée, confirmation, miniature demandée au worker', async () => {
    const id = randomUUID();
    const request = { id, name: 'photo.png', mimeType: 'image/png', size: PNG.length };
    const res = await technicien.post('/v1/acme/files/upload').send(request).expect(201);
    expect(res.body.file).toMatchObject({ id, status: 'pending', url: null });

    await technicien.post(`/v1/acme/files/${id}/complete`).expect(409); // pas encore déposé

    const put = await fetch(res.body.upload.url, {
      method: 'PUT',
      headers: res.body.upload.headers,
      body: PNG,
    });
    expect(put.status).toBe(200);

    // Reprise : redemander l'URL avec le même identifiant ne crée pas de doublon.
    await technicien.post('/v1/acme/files/upload').send(request).expect(201);

    const done = await technicien.post(`/v1/acme/files/${id}/complete`).expect(200);
    expect(done.body).toMatchObject({ status: 'uploaded', url: expect.stringContaining(id) });
    const download = await fetch(done.body.url);
    expect(Buffer.from(await download.arrayBuffer())).toEqual(PNG);

    const job = await queue.getJob(`thumbnail-${id}`);
    expect(job?.data).toMatchObject({ fileId: id, instanceId: tenant.instance.id });
    await job?.remove();

    const again = await technicien.post('/v1/acme/files/upload').send(request).expect(201);
    expect(again.body.upload).toBeNull();
  });

  it('refuse un contenu différent pour un même identifiant et un fichier trop gros', async () => {
    const id = randomUUID();
    await technicien
      .post('/v1/acme/files/upload')
      .send({ id, name: 'a.pdf', mimeType: 'application/pdf', size: 10 })
      .expect(201);
    await technicien
      .post('/v1/acme/files/upload')
      .send({ id, name: 'a.pdf', mimeType: 'application/pdf', size: 11 })
      .expect(409);
    await technicien
      .post('/v1/acme/files/upload')
      .send({ name: 'gros.mp4', mimeType: 'video/mp4', size: 100 * 1024 * 1024 })
      .expect(400);
    await technicien
      .post('/v1/acme/files/upload')
      .send({ name: 'x', mimeType: 'pas un type', size: 1 })
      .expect(400);
  });

  it('refuse un dépôt dont la taille ne correspond pas à la signature', async () => {
    const res = await technicien
      .post('/v1/acme/files/upload')
      .send({ name: 'p.png', mimeType: 'image/png', size: PNG.length })
      .expect(201);
    const put = await fetch(res.body.upload.url, {
      method: 'PUT',
      headers: res.body.upload.headers,
      body: Buffer.concat([PNG, PNG]),
    });
    expect(put.ok).toBe(false);
  });
});

describe('paramètres de l instance', () => {
  it('personnalise couleurs, fuseau et menu mobile', async () => {
    const res = await admin
      .patch('/v1/acme/settings')
      .send({
        branding: { primaryColor: '#0A5C8A' },
        timeZone: 'Africa/Lagos',
        mobileMenu: [
          {
            id: 't1',
            label: 'Inspection',
            icon: 'clipboard-check',
            kind: 'structure',
            structureId: tenant.structure.id,
          },
          { id: 't2', label: 'Scanner', icon: 'scan-line', kind: 'scan' },
        ],
      })
      .expect(200);
    expect(res.body).toMatchObject({
      timeZone: 'Africa/Lagos',
      branding: { primaryColor: '#0A5C8A' },
    });
    const read = await technicien.get('/v1/acme/settings').expect(200);
    expect(read.body.mobileMenu).toHaveLength(2);
  });

  it('valide les paramètres et réserve la modification à instance:manage', async () => {
    await admin.patch('/v1/acme/settings').send({ timeZone: 'Mars/Olympus' }).expect(400);
    await admin
      .patch('/v1/acme/settings')
      .send({ mobileMenu: [{ id: 't', label: 'X', icon: 'x', kind: 'structure' }] })
      .expect(400);
    await admin
      .patch('/v1/acme/settings')
      .send({
        mobileMenu: [
          { id: 't', label: 'X', icon: 'x', kind: 'structure', structureId: randomUUID() },
        ],
      })
      .expect(400);
    await admin
      .patch('/v1/acme/settings')
      .send({ branding: { logoFileId: randomUUID() } })
      .expect(400);
    await technicien.patch('/v1/acme/settings').send({ name: 'Pirate' }).expect(403);
  });
});
