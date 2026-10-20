import { type INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { tenantTransaction } from '../src/prisma/tenant';
import {
  api,
  createDemoTenant,
  createTestApp,
  demoItems,
  login,
  owner,
  resetDatabase,
} from './helpers';

let app: INestApplication;
let tenant: Awaited<ReturnType<typeof createDemoTenant>>;
let items: Record<string, string>;
let technicien: ReturnType<typeof api>;
let superviseur: ReturnType<typeof api>;

const fileId = randomUUID();
const data = (etat = 'bon') => ({
  site: items['S-PLT'],
  batiment: items['B-PLT-A'],
  equipement: items['EQ-0001'],
  etat,
  signature: { fileId },
  // Un équipement dégradé ou hors service exige des photos (et une description si hors service).
  ...(etat === 'bon' ? {} : { photos: [{ fileId }], description_defaut: 'Constat initial' }),
});

type Pull = {
  cursor: string;
  hasMore: boolean;
  structures: { id: string; currentVersionId: string; rights: string[] }[];
  versions: { id: string; definition: unknown }[];
  lists: unknown[];
  listItems: { id: string; label: string; archived: boolean }[];
  submissions: {
    id: string;
    deleted: boolean;
    revision?: number;
    data?: Record<string, unknown>;
  }[];
};

/** Pull complet (toutes les pages), comme le moteur de synchronisation mobile. */
async function pullAll(client: ReturnType<typeof api>, cursor?: string, limit?: number) {
  const pages: Pull[] = [];
  let next = cursor;
  for (let guard = 0; guard < 50; guard++) {
    const query = new URLSearchParams({
      ...(next ? { cursor: next } : {}),
      ...(limit ? { limit: String(limit) } : {}),
    });
    const res = await client.get(`/v1/acme/sync/pull?${query}`).expect(200);
    pages.push(res.body as Pull);
    next = res.body.cursor;
    if (!res.body.hasMore) break;
  }
  return {
    cursor: next!,
    pages,
    listItems: pages.flatMap((p) => p.listItems),
    submissions: pages.flatMap((p) => p.submissions),
    versions: pages.flatMap((p) => p.versions),
    last: pages.at(-1)!,
  };
}

const push = (client: ReturnType<typeof api>, mutations: unknown[]) =>
  client.post('/v1/acme/sync/push').send({ mutations }).expect(200);

const create = (submissionId = randomUUID(), etat = 'bon') => ({
  id: `m-${submissionId}`,
  type: 'create',
  submissionId,
  structureId: tenant.structure.id,
  data: data(etat),
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
  technicien = api(app, (await login(app, 'technicien@acme.test')).access_token);
  superviseur = api(app, (await login(app, 'superviseur@acme.test')).access_token);
});

describe('pull', () => {
  it('première synchronisation : formulaires, définitions, référentiels, droits', async () => {
    const first = await pullAll(technicien);
    const structure = first.last.structures.find((s) => s.id === tenant.structure.id)!;
    expect(structure.rights).toEqual(['create', 'read:own', 'update']);
    expect(first.versions.map((v) => v.id)).toContain(structure.currentVersionId);
    expect(first.last.lists).toHaveLength(1);
    expect(first.listItems).toHaveLength(11);
    expect(first.submissions).toEqual([]);
  });

  it('incrémental : seulement les changements depuis le curseur, suppressions comprises', async () => {
    const id = randomUUID();
    await push(technicien, [create(id)]);
    const first = await pullAll(technicien);
    expect(first.submissions.map((s) => s.id)).toEqual([id]);

    const idle = await pullAll(technicien, first.cursor);
    expect(idle.submissions).toEqual([]);
    expect(idle.listItems).toEqual([]);
    expect(idle.versions).toEqual([]);

    await push(technicien, [
      {
        id: 'u1',
        type: 'update',
        submissionId: id,
        data: { etat: 'degrade', description_defaut: 'Fuite', photos: [{ fileId }] },
      },
    ]);
    const changed = await pullAll(technicien, idle.cursor);
    expect(changed.submissions).toMatchObject([
      { id, deleted: false, revision: 2, data: { etat: 'degrade' } },
    ]);

    await superviseur.delete(`/v1/acme/submissions/${id}`).expect(204);
    const deleted = await pullAll(technicien, changed.cursor);
    expect(deleted.submissions).toEqual([{ id, structureId: tenant.structure.id, deleted: true }]);
  });

  it('joint à chaque fiche ses dernières révisions, auteurs nommés (historique hors ligne)', async () => {
    const id = randomUUID();
    await push(technicien, [create(id)]);
    await superviseur
      .patch(`/v1/acme/submissions/${id}`)
      .send({ data: { etat: 'degrade', description_defaut: 'Fuite', photos: [{ fileId }] } })
      .expect(200);
    const [pulled] = (await pullAll(technicien)).submissions as unknown as {
      historyTotal: number;
      history: { revision: number; action: string; author: string | null; changes: unknown[] }[];
    }[];
    expect(pulled!.historyTotal).toBe(2);
    expect(pulled!.history.map((h) => [h.revision, h.action])).toEqual([
      [2, 'update'],
      [1, 'create'],
    ]);
    expect(pulled!.history[0]).toMatchObject({
      author: 'superviseur acme',
      automation: null,
      changes: expect.arrayContaining([{ field: 'etat', before: 'bon', after: 'degrade' }]),
    });
    expect(pulled!.history[1]!.author).toBe('technicien acme');
  });

  it('ne transmet que les fiches lisibles : le technicien ne reçoit que les siennes', async () => {
    await push(superviseur, [create()]);
    await push(technicien, [create()]);
    expect((await pullAll(technicien)).submissions).toHaveLength(1);
    expect((await pullAll(superviseur)).submissions).toHaveLength(2);
  });

  it('pagine sans perte ni boucle', async () => {
    await push(
      technicien,
      Array.from({ length: 7 }, () => create()),
    );
    const all = await pullAll(technicien, undefined, 3);
    expect(all.pages.length).toBeGreaterThan(3);
    expect(new Set(all.submissions.map((s) => s.id)).size).toBe(7);
    expect(new Set(all.listItems.map((i) => i.id)).size).toBe(11);
  });

  it('ne perd jamais une écriture encore en cours pendant le pull', async () => {
    const first = await pullAll(technicien);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let inserted!: () => void;
    const insertedSignal = new Promise<void>((resolve) => (inserted = resolve));
    // Transaction ouverte : l'élément a son sync_txid mais n'est pas encore validé.
    const pending = tenantTransaction(owner(), { instanceId: tenant.instance.id }, async (tx) => {
      await tx.listItem.create({
        data: {
          instanceId: tenant.instance.id,
          listId: tenant.list.id,
          level: 0,
          label: 'Site tardif',
          code: 'S-LATE',
        },
      });
      inserted();
      await gate;
    });
    await insertedSignal;
    const during = await pullAll(technicien, first.cursor);
    expect(during.listItems.map((i) => i.label)).not.toContain('Site tardif');
    release();
    await pending;
    const after = await pullAll(technicien, during.cursor);
    expect(after.listItems.map((i) => i.label)).toContain('Site tardif');
  });

  it('transmet la nouvelle définition après publication', async () => {
    const first = await pullAll(technicien);
    const admin = api(app, (await login(app, 'admin@acme.test')).access_token);
    const v1 = await admin
      .get(`/v1/acme/structures/${tenant.structure.id}/versions/current`)
      .expect(200);
    await admin
      .put(`/v1/acme/structures/${tenant.structure.id}/draft`)
      .send({ definition: v1.body.definition })
      .expect(200);
    await admin.post(`/v1/acme/structures/${tenant.structure.id}/publish`).expect(200);
    const next = await pullAll(technicien, first.cursor);
    expect(next.versions).toHaveLength(1);
    expect(next.last.structures[0]!.currentVersionId).toBe(next.versions[0]!.id);
  });

  it('refuse un curseur invalide', async () => {
    const res = await technicien.get('/v1/acme/sync/pull?cursor=abc').expect(400);
    expect(res.body.error).toBe('invalid_cursor');
  });
});

describe('push', () => {
  it('mode avion : 10 fiches envoyées puis rejouées, sans doublon', async () => {
    const batch = Array.from({ length: 10 }, () => create());
    const first = await push(technicien, batch);
    expect(first.body.results.map((r: { status: string }) => r.status)).toEqual(
      Array(10).fill('applied'),
    );
    // Coupure réseau avant réception de la réponse : le client renvoie tout le lot.
    const replay = await push(technicien, batch);
    expect(replay.body.results.map((r: { status: string }) => r.status)).toEqual(
      Array(10).fill('duplicate'),
    );
    expect(
      (await superviseur.get(`/v1/acme/structures/${tenant.structure.id}/submissions`).expect(200))
        .body.meta.total,
    ).toBe(10);
  });

  it('refuse une mutation invalide sans bloquer le reste du lot', async () => {
    const id = randomUUID();
    const res = await push(technicien, [
      {
        id: 'bad',
        type: 'create',
        submissionId: randomUUID(),
        structureId: tenant.structure.id,
        data: { etat: 'hors_service' },
      },
      create(id),
      { id: 'orphan', type: 'update', submissionId: randomUUID(), data: { etat: 'bon' } },
    ]);
    expect(res.body.results).toMatchObject([
      { id: 'bad', status: 'rejected', error: { status: 422, code: 'invalid_data' } },
      { id: `m-${id}`, status: 'applied' },
      { id: 'orphan', status: 'rejected', error: { status: 404 } },
    ]);
  });

  it('accepte une modification arrivée avant la création, une fois celle-ci reçue', async () => {
    const id = randomUUID();
    const update = {
      id: 'u-early',
      type: 'update',
      submissionId: id,
      baseRevision: 1,
      data: { etat: 'degrade', description_defaut: 'x', photos: [{ fileId }] },
    };
    expect((await push(technicien, [update])).body.results[0].status).toBe('rejected');
    await push(technicien, [create(id)]);
    expect((await push(technicien, [update])).body.results[0]).toMatchObject({
      status: 'applied',
      conflicts: [],
    });
  });

  it('valide la forme du lot', async () => {
    await technicien.post('/v1/acme/sync/push').send({ mutations: [] }).expect(400);
    await technicien
      .post('/v1/acme/sync/push')
      .send({ mutations: [{ id: 'x', type: 'inconnu' }] })
      .expect(400);
  });
});

describe('conflits', () => {
  it('fusionne des champs différents et trace un conflit sur le même champ', async () => {
    const id = randomUUID();
    await push(technicien, [create(id, 'degrade')]);

    // Deux appareils partent de la révision 1.
    const a = await push(technicien, [
      {
        id: 'a',
        type: 'update',
        submissionId: id,
        baseRevision: 1,
        data: { description_defaut: 'Fuite A', etat: 'hors_service' },
      },
    ]);
    expect(a.body.results[0].conflicts).toEqual([]);
    const b = await push(superviseur, [
      {
        id: 'b',
        type: 'update',
        submissionId: id,
        baseRevision: 1,
        data: { description_defaut: 'Fuite B', position: { lat: 5.3, lng: -4, source: 'manual' } },
      },
    ]);
    expect(b.body.results[0]).toMatchObject({
      status: 'applied',
      conflicts: ['description_defaut'],
    });

    const current = await superviseur.get(`/v1/acme/submissions/${id}`).expect(200);
    // Dernière écriture reçue gagne ; les champs distincts sont fusionnés.
    expect(current.body.data).toMatchObject({
      description_defaut: 'Fuite B',
      etat: 'hors_service',
      position: { lat: 5.3, lng: -4, source: 'manual' },
    });

    const conflicts = await superviseur.get(`/v1/acme/submissions/${id}/conflicts`).expect(200);
    expect(conflicts.body.data).toMatchObject([
      {
        field: 'description_defaut',
        baseRevision: 1,
        appliedValue: { value: 'Fuite B' },
        overwrittenValue: { value: 'Fuite A' },
        clientMutationId: 'b',
        resolvedAt: null,
      },
    ]);

    const conflictId = conflicts.body.data[0].id;
    await superviseur
      .post(`/v1/acme/submissions/${id}/conflicts/${conflictId}/resolve`)
      .send({ resolution: 'restored' })
      .expect(200);
    expect(
      (await superviseur.get(`/v1/acme/submissions/${id}`).expect(200)).body.data
        .description_defaut,
    ).toBe('Fuite A');
    await superviseur
      .post(`/v1/acme/submissions/${id}/conflicts/${conflictId}/resolve`)
      .send({ resolution: 'kept' })
      .expect(409);
  });

  it('sérialise les écritures concurrentes sur une même fiche', async () => {
    const id = randomUUID();
    await push(technicien, [create(id, 'degrade')]);
    const updates = Array.from({ length: 5 }, (_, i) =>
      push(technicien, [
        {
          id: `c${i}`,
          type: 'update',
          submissionId: id,
          baseRevision: 1,
          data: { description_defaut: `v${i}` },
        },
      ]),
    );
    await Promise.all(updates);
    const submission = await technicien.get(`/v1/acme/submissions/${id}`).expect(200);
    expect(submission.body.revision).toBe(6);
    const conflicts = await superviseur.get(`/v1/acme/submissions/${id}/conflicts`).expect(200);
    expect(conflicts.body.data).toHaveLength(4);
  });
});
