import { type INestApplication } from '@nestjs/common';
import { inspectionWorkflow } from '@wasafili/form-schema';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createTenant, createTestApp, login, resetDatabase } from './helpers';

let app: INestApplication;
let tenant: Awaited<ReturnType<typeof createTenant>>;
let admin: ReturnType<typeof api>;
let superviseur: ReturnType<typeof api>;
let technicien: ReturnType<typeof api>;
let structureId: string;
let technicienId: string;
let superviseurId: string;

const slot = (hour: number) => ({
  startAt: `2026-11-02T${String(hour).padStart(2, '0')}:00:00.000Z`,
  endAt: `2026-11-02T${String(hour + 1).padStart(2, '0')}:00:00.000Z`,
});

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase();
  tenant = await createTenant('acme');
  superviseurId = tenant.users[1]!.id;
  technicienId = tenant.users[2]!.id;
  admin = api(app, (await login(app, 'admin@acme.test')).access_token);
  superviseur = api(app, (await login(app, 'superviseur@acme.test')).access_token);
  technicien = api(app, (await login(app, 'technicien@acme.test')).access_token);
  const { body } = await admin.post('/v1/acme/structures').send({ name: 'Visite' }).expect(201);
  structureId = body.id as string;
  await admin
    .put(`/v1/acme/structures/${structureId}/draft`)
    .send({
      definition: {
        schemaVersion: 1,
        workflow: inspectionWorkflow,
        fields: [{ id: 'f-eq', key: 'equipement', type: 'text', label: 'Équipement' }],
      },
    })
    .expect(200);
  await admin.post(`/v1/acme/structures/${structureId}/publish`).expect(200);
});

const createTask = (extra: Record<string, unknown> = {}) =>
  superviseur
    .post('/v1/acme/tasks')
    .send({ structureId, title: 'Contrôle groupe', ...slot(8), ...extra });

const pull = async (client: ReturnType<typeof api>, cursor?: string) =>
  (
    await client
      .get('/v1/acme/sync/pull')
      .query(cursor ? { cursor } : {})
      .expect(200)
  ).body;

describe('tâches', () => {
  it('planifie, notifie l’assigné et limite la lecture aux tâches assignées', async () => {
    const assigned = await createTask({
      assigneeUserId: technicienId,
      locationLabel: 'Tour Alpha',
      prefill: { equipement: 'EQ-0001' },
    }).expect(201);
    expect(assigned.body).toMatchObject({ status: 'todo', assigneeUserId: technicienId });
    await createTask({ assigneeUserId: superviseurId }).expect(201);
    await technicien
      .post('/v1/acme/tasks')
      .send({ structureId, title: 'x', ...slot(9) })
      .expect(403);

    const mine = await technicien.get('/v1/acme/tasks').expect(200);
    expect(mine.body.data.map((t: { id: string }) => t.id)).toEqual([assigned.body.id]);
    expect((await superviseur.get('/v1/acme/tasks').expect(200)).body.meta.total).toBe(2);

    const { body: inbox } = await technicien.get('/v1/acme/notifications').expect(200);
    expect(inbox.meta.unread).toBe(1);
    expect(inbox.data[0]).toMatchObject({
      type: 'task_assigned',
      title: 'Nouvelle tâche',
      body: 'Contrôle groupe — 2 nov. 2026, 08:00',
      data: { taskId: assigned.body.id },
    });
    await technicien.post('/v1/acme/notifications/read').send({}).expect(200);
    expect((await technicien.get('/v1/acme/notifications').expect(200)).body.meta.unread).toBe(0);
  });

  it('filtre par période et valide les références', async () => {
    await createTask().expect(201);
    await createTask(slot(14)).expect(201);
    const { body } = await superviseur
      .get('/v1/acme/tasks')
      .query({ from: '2026-11-02T10:00:00Z', to: '2026-11-02T18:00:00Z' })
      .expect(200);
    expect(body.data).toHaveLength(1);

    const bad = await createTask({ startAt: slot(9).startAt, endAt: slot(8).startAt }).expect(422);
    expect(bad.body.error).toBe('invalid_task');
    await createTask({ assigneeUserId: randomUUID() }).expect(422);
    await createTask({ structureId: randomUUID() }).expect(422);
  });

  it('réassigne par groupe et retire la tâche de l’ancien appareil', async () => {
    const task = (await createTask({ assigneeUserId: technicienId }).expect(201)).body;
    const first = await pull(technicien);
    expect(first.tasks).toMatchObject([{ id: task.id, deleted: false, title: 'Contrôle groupe' }]);
    expect(first.notifications).toHaveLength(1);

    const group = (await admin.post('/v1/acme/groups').send({ name: 'Équipe B' }).expect(201)).body;
    await admin.put(`/v1/acme/groups/${group.id}/members`).send({ userIds: [superviseurId] });
    const moved = await admin
      .patch(`/v1/acme/tasks/${task.id}`)
      .send({ assigneeGroupId: group.id, ...slot(10) })
      .expect(200);
    expect(moved.body).toMatchObject({ assigneeUserId: null, assigneeGroupId: group.id });

    const second = await pull(technicien, first.cursor);
    expect(second.tasks).toEqual([{ id: task.id, deleted: true }]);
    const groupPull = await pull(superviseur);
    expect(groupPull.tasks).toMatchObject([{ id: task.id, deleted: false }]);
    expect(groupPull.notifications[0]).toMatchObject({ type: 'task_assigned' });
  });

  it('retirée du groupe, l’ancienne membre ne garde pas ses tâches (synchronisation complète)', async () => {
    const group = (await admin.post('/v1/acme/groups').send({ name: 'Équipe C' }).expect(201)).body;
    await admin
      .put(`/v1/acme/groups/${group.id}/members`)
      .send({ userIds: [technicienId] })
      .expect(200);
    const task = (await createTask({ assigneeGroupId: group.id }).expect(201)).body;
    const first = await pull(technicien);
    expect(first.tasks).toMatchObject([{ id: task.id, deleted: false }]);

    // Retrait du groupe sans toucher à la tâche : les droits changent, le pull repart de zéro.
    await admin.put(`/v1/acme/groups/${group.id}/members`).send({ userIds: [] }).expect(200);
    const second = await pull(technicien, first.cursor);
    expect(second.reset).toBe(true);
    expect(second.tasks).toEqual([{ id: task.id, deleted: true }]);
  });

  it('se clôt par la fiche créée depuis la tâche, hors ligne compris', async () => {
    const task = (await createTask({ assigneeUserId: technicienId }).expect(201)).body;
    const other = (await createTask({ assigneeUserId: superviseurId }).expect(201)).body;
    const push = (taskId: string) =>
      technicien
        .post('/v1/acme/sync/push')
        .send({
          mutations: [
            {
              id: randomUUID(),
              type: 'create',
              submissionId: randomUUID(),
              structureId,
              data: { equipement: 'EQ-0001' },
              taskId,
            },
          ],
        })
        .expect(200);
    const done = await push(task.id);
    expect(done.body.results[0].status).toBe('applied');
    expect((await superviseur.get(`/v1/acme/tasks/${task.id}`)).body).toMatchObject({
      status: 'done',
      submissionId: done.body.results[0].submission.id,
    });
    // Tâche d'un autre : la fiche est enregistrée, la tâche reste ouverte.
    expect((await push(other.id)).body.results[0].status).toBe('applied');
    expect((await superviseur.get(`/v1/acme/tasks/${other.id}`)).body.status).toBe('todo');
  });
});

describe('notifications de workflow', () => {
  it("prévient l'auteur d'un changement d'état fait par un autre", async () => {
    const fiche = (
      await technicien
        .post(`/v1/acme/structures/${structureId}/submissions`)
        .send({ data: {} })
        .expect(201)
    ).body;
    await technicien
      .post(`/v1/acme/submissions/${fiche.id}/transition`)
      .send({ transition: 'soumettre' })
      .expect(200);
    expect((await technicien.get('/v1/acme/notifications')).body.meta.total).toBe(0);
    await superviseur
      .post(`/v1/acme/submissions/${fiche.id}/transition`)
      .send({ transition: 'valider' })
      .expect(200);
    const { body } = await technicien.get('/v1/acme/notifications').expect(200);
    expect(body.data).toMatchObject([
      {
        type: 'submission_state',
        title: 'Visite : Validé',
        body: 'Votre fiche est passée de « Soumis » à « Validé »',
        data: { submissionId: fiche.id },
      },
    ]);
  });

  it('enregistre et retire un jeton push', async () => {
    await technicien
      .post('/v1/acme/push-tokens')
      .send({ token: 'ExponentPushToken[abc]', platform: 'ios' })
      .expect(204);
    await superviseur
      .post('/v1/acme/push-tokens')
      .send({ token: 'ExponentPushToken[abc]' })
      .expect(204);
    await superviseur
      .delete('/v1/acme/push-tokens')
      .query({ token: 'ExponentPushToken[abc]' })
      .expect(204);
  });
});
