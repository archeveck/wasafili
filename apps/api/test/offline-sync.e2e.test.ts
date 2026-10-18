import { type INestApplication } from '@nestjs/common';
import { ApiError, createClient, type Tokens } from '@tesserax/sdk';
import {
  LocalStore,
  type SqlDatabase,
  type SqlValue,
  SyncEngine,
  type SyncTransport,
  TransientError,
} from '@tesserax/sync';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  api,
  createDemoTenant,
  createTestApp,
  demoItems,
  login,
  PASSWORD,
  resetDatabase,
} from './helpers';

/**
 * Critère d'acceptation (P3.8.1, au niveau protocole) : un technicien en mode avion remplit
 * 10 fiches avec photos ; au retour du réseau, tout se synchronise sans doublon ni perte.
 * Moteur et base locale réels (@tesserax/sync sur SQLite), API, PostgreSQL et MinIO réels.
 */
let app: INestApplication;
let baseUrl: string;
let tenant: Awaited<ReturnType<typeof createDemoTenant>>;
let items: Record<string, string>;

// JPEG minimal valide (1×1).
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64',
);

function nodeDatabase(): SqlDatabase {
  const db = new DatabaseSync(':memory:');
  return {
    exec: (sql) => db.exec(sql),
    run: (sql, params: readonly SqlValue[] = []) => ({
      changes: Number(db.prepare(sql).run(...params).changes),
    }),
    all: <T>(sql: string, params: readonly SqlValue[] = []) =>
      db.prepare(sql).all(...params) as T[],
    get: <T>(sql: string, params: readonly SqlValue[] = []) =>
      db.prepare(sql).get(...params) as T | undefined,
    transaction: <T>(fn: () => T) => {
      db.exec('BEGIN');
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

/** Appareil simulé : base locale, client API, réseau coupable, fichiers « sur le téléphone ». */
async function device(email: string) {
  const network = { online: true, failNextPut: false };
  let tokens: Tokens | null = null;
  const files = new Map<string, Buffer>();
  const fetchImpl: typeof fetch = async (input, init) => {
    if (!network.online) throw new TypeError('Network request failed');
    if (network.failNextPut && init?.method === 'PUT') {
      network.failNextPut = false;
      throw new TypeError('Connexion interrompue pendant l envoi');
    }
    return fetch(input, init);
  };
  const client = createClient({
    baseUrl,
    fetch: fetchImpl,
    tokens: { get: () => tokens, set: (t) => (tokens = t) },
  });
  await client.login(email, PASSWORD);
  const remote = client.app('acme');
  // Erreurs réseau et serveur : temporaires ; le moteur réessaiera.
  const transient = async <T>(call: () => Promise<T>) => {
    try {
      return await call();
    } catch (error) {
      if (error instanceof TypeError || (error instanceof ApiError && error.status >= 500)) {
        throw new TransientError(error.message);
      }
      throw error;
    }
  };
  const transport: SyncTransport = {
    pull: (cursor) => transient(() => remote.sync.pull(cursor)),
    push: (mutations) => transient(async () => (await remote.sync.push(mutations)).results),
    upload: (task) =>
      transient(async () => {
        const bytes = files.get(task.fileId)!;
        await remote.files.upload(
          new File([bytes], task.name, { type: task.mimeType }),
          task.fileId,
        );
      }),
  };
  const store = new LocalStore(nodeDatabase(), { newId: randomUUID });
  return { network, store, engine: new SyncEngine(store, transport), files };
}

beforeAll(async () => {
  app = await createTestApp();
  await app.listen(0);
  baseUrl = await app.getUrl();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase();
  tenant = await createDemoTenant('acme');
  items = await demoItems(tenant.instance.id);
});

describe('synchronisation hors ligne de bout en bout', () => {
  it('10 fiches avec photos en mode avion : synchronisées sans doublon ni perte', async () => {
    const phone = await device('technicien@acme.test');
    expect((await phone.engine.sync()).error).toBeUndefined();
    expect(phone.store.structures().map((s) => s.name)).toEqual(['Inspection équipement']);
    expect(phone.store.lookupCode('EQ-0001')).toHaveLength(1);

    phone.network.online = false;
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const photo = randomUUID();
      phone.files.set(photo, JPEG);
      const id = phone.store.saveDraft({
        structureId: tenant.structure.id,
        data: {
          site: items['S-PLT'],
          batiment: items['B-PLT-A'],
          equipement: items['EQ-0001'],
          date_inspection: '2026-10-18',
          etat: 'degrade',
          description_defaut: `Constat ${i}`,
          photos: [{ fileId: photo, name: `${i}.jpg`, mimeType: 'image/jpeg' }],
          signature: { fileId: photo },
        },
        location: { lat: 5.32, lng: -4.02, accuracy: 8 },
      });
      phone.store.submit(id);
      phone.store.addUpload({
        fileId: photo,
        submissionId: id,
        uri: `file:///${photo}.jpg`,
        name: `${i}.jpg`,
        mimeType: 'image/jpeg',
        size: JPEG.length,
      });
      ids.push(id);
    }
    const offline = await phone.engine.sync();
    expect(offline).toMatchObject({ transient: true, pushed: 0 });

    // Retour du réseau, avec une coupure pendant l'envoi d'une photo.
    phone.network.online = true;
    phone.network.failNextPut = true;
    const first = await phone.engine.sync();
    expect(first).toMatchObject({ pushed: 10, rejected: 0, transient: true });
    const second = await phone.engine.sync();
    expect(second.error).toBeUndefined();
    expect(phone.store.stats()).toMatchObject({
      pending: 0,
      failed: 0,
      uploadsPending: 0,
      uploadsFailed: 0,
    });

    const superviseur = api(app, (await login(app, 'superviseur@acme.test')).access_token);
    const list = await superviseur
      .get(`/v1/acme/structures/${tenant.structure.id}/submissions?per_page=100`)
      .expect(200);
    expect(list.body.meta.total).toBe(10);
    expect(list.body.data.map((s: { id: string }) => s.id).sort()).toEqual([...ids].sort());
    for (const submission of list.body.data) {
      expect(submission.location).toMatchObject({ lat: 5.32, lng: -4.02 });
      const photo = await superviseur
        .get(`/v1/acme/files/${submission.data.photos[0].fileId}`)
        .expect(200);
      expect(photo.body.status).toBe('uploaded');
    }
    expect(phone.store.submissions().every((s) => s.status === 'synced')).toBe(true);

    // Synchroniser à nouveau ne crée rien.
    await phone.engine.sync();
    expect(
      (await superviseur.get(`/v1/acme/structures/${tenant.structure.id}/submissions`).expect(200))
        .body.meta.total,
    ).toBe(10);
  });

  it('modifications concurrentes depuis le terrain et le bureau : fusion et conflit tracé', async () => {
    const phone = await device('technicien@acme.test');
    await phone.engine.sync();
    const id = phone.store.saveDraft({
      structureId: tenant.structure.id,
      data: {
        site: items['S-PLT'],
        batiment: items['B-PLT-A'],
        equipement: items['EQ-0001'],
        etat: 'bon',
        signature: { fileId: randomUUID() },
      },
    });
    phone.store.submit(id);
    await phone.engine.sync();

    // Le téléphone passe hors ligne et modifie la fiche…
    phone.network.online = false;
    const local = phone.store.submission(id)!;
    phone.store.edit(id, {
      ...local.data,
      position: { lat: 5.3, lng: -4, source: 'manual' },
      etat: 'hors_service',
      description_defaut: 'Terrain',
      photos: [{ fileId: randomUUID() }],
    });
    // …pendant qu'au bureau, quelqu'un modifie aussi l'état.
    const superviseur = api(app, (await login(app, 'superviseur@acme.test')).access_token);
    await superviseur
      .patch(`/v1/acme/submissions/${id}`)
      .send({
        data: { etat: 'degrade', description_defaut: 'Bureau', photos: [{ fileId: randomUUID() }] },
        baseRevision: 1,
      })
      .expect(200);

    phone.network.online = true;
    expect((await phone.engine.sync()).error).toBeUndefined();
    const merged = (await superviseur.get(`/v1/acme/submissions/${id}`).expect(200)).body;
    expect(merged.data).toMatchObject({
      etat: 'hors_service',
      description_defaut: 'Terrain',
      position: { lat: 5.3 },
    });
    const conflicts = (await superviseur.get(`/v1/acme/submissions/${id}/conflicts`).expect(200))
      .body.data;
    expect(conflicts.map((c: { field: string }) => c.field).sort()).toEqual([
      'description_defaut',
      'etat',
      'photos',
    ]);
    expect(phone.store.submission(id)).toMatchObject({ status: 'synced', revision: 3 });
  });
});
