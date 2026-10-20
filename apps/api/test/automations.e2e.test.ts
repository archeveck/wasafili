import { type INestApplication } from '@nestjs/common';
import { AUTOMATION_QUEUE_NAME } from '@wasafili/jobs';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AutomationRunner } from '../src/automations/automation-runner';
import { runWithContext } from '../src/common/request-context';
import { tenantTransaction } from '../src/prisma/tenant';
import { demoReportDocx } from '../src/reports/demo-template';
import { solidPng } from '../src/reports/build-docx';
import {
  api,
  createDemoTenant,
  createTestApp,
  demoItems,
  login,
  owner,
  resetDatabase,
  TEST_QUEUE_PREFIX,
} from './helpers';

let app: INestApplication;
let tenant: Awaited<ReturnType<typeof createDemoTenant>>;
let admin: ReturnType<typeof api>;
let superviseur: ReturnType<typeof api>;
let technicien: ReturnType<typeof api>;
let structureId: string;
let queue: Queue;

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

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
  await fetch(res.body.upload.url, {
    method: 'PUT',
    headers: res.body.upload.headers,
    body: new Uint8Array(body),
  });
  await client.post(`/v1/acme/files/${id}/complete`).expect(200);
  return id;
}

/** Attend qu'une condition soit vraie (exécution asynchrone par la file). */
async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, timeout = 20_000) {
  const start = Date.now();
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() - start > timeout) throw new Error(`Délai dépassé : ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

const runs = async (query: Record<string, string> = {}) =>
  (
    await admin
      .get('/v1/acme/automation-runs')
      .query({ per_page: 100, ...query })
      .expect(200)
  ).body.data as {
    id: string;
    status: string;
    depth: number;
    error: string | null;
    automationId: string;
    steps: { status: string; result?: Record<string, unknown> }[];
  }[];

const inInstance = <T>(
  fn: (tx: Parameters<Parameters<typeof tenantTransaction>[2]>[0]) => Promise<T>,
) => tenantTransaction(owner(), { instanceId: tenant.instance.id }, fn);

async function validFiche(client: ReturnType<typeof api>) {
  const items = await demoItems(tenant.instance.id);
  const signature = await upload(client, solidPng(40, 20, [0, 0, 0]), 'sig.png', 'image/png');
  const res = await client
    .post(`/v1/acme/structures/${structureId}/submissions`)
    .send({
      data: {
        site: items['S-PLT'],
        batiment: items['B-PLT-A'],
        equipement: items['EQ-0003'],
        etat: 'bon',
        photos: [{ fileId: signature }],
        signature: { fileId: signature },
      },
    })
    .expect(201);
  return res.body.id as string;
}

beforeAll(async () => {
  app = await createTestApp({
    GOTENBERG_URL: process.env['GOTENBERG_URL'] ?? 'http://localhost:3001',
  });
  queue = new Queue(AUTOMATION_QUEUE_NAME, {
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
  structureId = tenant.structure.id;
  admin = api(app, (await login(app, 'admin@acme.test')).access_token);
  superviseur = api(app, (await login(app, 'superviseur@acme.test')).access_token);
  technicien = api(app, (await login(app, 'technicien@acme.test')).access_token);
});

describe('automatisations', () => {
  it('refuse une configuration incohérente avec la structure, en expliquant chaque point', async () => {
    const res = await admin
      .post('/v1/acme/automations')
      .send({
        name: 'Incohérente',
        structureId,
        trigger: { type: 'state_changed', to: ['archive'] },
        actions: [
          { type: 'notify', to: [{ type: 'address', email: 'a@b.ci' }], title: 'x' },
          { type: 'update_field', field: 'total_pieces', value: 3 },
          { type: 'update_field', field: 'etat', value: 'inexistant_mais_texte' },
          { type: 'email', to: [{ type: 'field', field: 'etat' }], subject: 's', body: 'b' },
        ],
      })
      .expect(422);
    expect(res.body.error).toBe('invalid_automation');
    expect(res.body.details).toEqual([
      { path: 'trigger.to.0', message: 'État inconnu : archive' },
      {
        path: 'actions.0.to.0',
        message: 'Une notification s’adresse à des utilisateurs de l’instance',
      },
      {
        path: 'actions.1.field',
        message: '« Total pièces (FCFA) » ne peut pas être fixé par une automatisation',
      },
      { path: 'actions.3.to.0', message: "« etat » n'est pas un champ e-mail" },
    ]);
    await technicien.get('/v1/acme/automations').expect(403);
  });

  it('validation d’une fiche → e-mail avec le rapport PDF, notification et tâche de suivi', async () => {
    const fileId = await upload(admin, demoReportDocx(), 'inspection.docx', DOCX);
    const report = await admin
      .post(`/v1/acme/structures/${structureId}/reports`)
      .send({ name: 'Rapport', fileId, filename: 'Inspection {{equipement}}' })
      .expect(201);
    const automation = await admin
      .post('/v1/acme/automations')
      .send({
        name: 'Rapport à la validation',
        structureId,
        trigger: { type: 'state_changed', to: ['valide'] },
        conditions: { '==': [{ var: 'etat' }, 'bon'] },
        actions: [
          {
            type: 'email',
            to: [{ type: 'address', email: 'Chef@Exemple.ci' }, { type: 'author' }],
            subject: 'Fiche {{equipement}} : {{_etat}}',
            body: 'Bonjour,\n\nLa fiche de {{_auteur}} est validée.',
            reportId: report.body.id,
          },
          { type: 'notify', to: [{ type: 'author' }], title: 'Rapport envoyé : {{equipement}}' },
          {
            type: 'create_task',
            title: 'Contrôle suivant {{equipement}}',
            assignee: { type: 'author' },
            startInDays: 30,
            startTime: '09:00',
            durationMinutes: 60,
            copyFields: true,
          },
        ],
      })
      .expect(201);

    const id = await validFiche(technicien);
    await technicien
      .post(`/v1/acme/submissions/${id}/transition`)
      .send({ transition: 'soumettre' })
      .expect(200);
    expect(await runs()).toEqual([]); // « soumis » ne déclenche pas
    await superviseur
      .post(`/v1/acme/submissions/${id}/transition`)
      .send({ transition: 'valider' })
      .expect(200);

    const [run] = await until(
      runs,
      (list) => list[0]?.status === 'succeeded' || list[0]?.status === 'failed',
    );
    expect(run).toMatchObject({ status: 'succeeded', automationId: automation.body.id, depth: 0 });
    expect(run!.steps.map((s) => s.status)).toEqual(['done', 'done', 'done']);

    // Historique de la fiche (P6.3.2) : visible de son auteur, sans le détail des étapes.
    const history = await technicien.get(`/v1/acme/submissions/${id}/automation-runs`).expect(200);
    expect(history.body.data).toEqual([
      expect.objectContaining({
        status: 'succeeded',
        event: 'transition',
        automation: { id: automation.body.id, name: expect.any(String) },
        steps: [
          { type: 'email', status: 'done' },
          { type: 'notify', status: 'done' },
          { type: 'create_task', status: 'done' },
        ],
      }),
    ]);

    const emails = (await admin.get('/v1/acme/emails').expect(200)).body.data;
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({
      to: ['chef@exemple.ci', 'technicien@acme.test'],
      subject: 'Fiche Ascenseur n°1 : Validé',
      status: 'queued',
      attachments: ['Inspection Ascenseur n°1.pdf'],
    });
    const stored = await inInstance((tx) => tx.emailMessage.findFirstOrThrow());
    expect(stored.text).toContain('La fiche de technicien acme est validée.');
    expect(stored.text).toMatch(/Ouvrir la fiche : http.+\/acme\/submissions\//);
    expect(stored.html).toContain('<p style="margin:0 0 12px">Bonjour,</p>');

    const notifications = (await technicien.get('/v1/acme/notifications').expect(200)).body.data;
    expect(notifications.map((n: { title: string }) => n.title)).toContain(
      'Rapport envoyé : Ascenseur n°1',
    );

    const task = await inInstance((tx) => tx.task.findFirstOrThrow());
    expect(task).toMatchObject({
      title: 'Contrôle suivant Ascenseur n°1',
      assigneeUserId: tenant.users[2]!.id,
    });
    expect(task.prefill).toMatchObject({ equipement: expect.any(String), etat: 'bon' });
    expect(task.endAt.getTime() - task.startAt.getTime()).toBe(3_600_000);

    // Condition non remplie : aucune exécution.
    const other = await validFiche(technicien);
    await technicien
      .patch(`/v1/acme/submissions/${other}`)
      .send({ data: { etat: 'degrade' } })
      .expect(200);
    await technicien
      .post(`/v1/acme/submissions/${other}/transition`)
      .send({ transition: 'soumettre' })
      .expect(200);
    await superviseur
      .post(`/v1/acme/submissions/${other}/transition`)
      .send({ transition: 'valider' })
      .expect(200);
    expect(await runs()).toHaveLength(1);
  });

  it('borne les chaînes d’automatisations (anti-boucle) et trace l’origine dans l’historique', async () => {
    const make = (name: string, value: string) =>
      admin
        .post('/v1/acme/automations')
        .send({
          name,
          structureId,
          trigger: { type: 'field_changed', fields: ['description_defaut'] },
          actions: [{ type: 'update_field', field: 'description_defaut', value }],
        })
        .expect(201);
    await make('Pose A', 'A');
    await make('Pose B', 'B');
    const id = await validFiche(admin);
    await admin
      .patch(`/v1/acme/submissions/${id}`)
      .send({ data: { etat: 'degrade', description_defaut: 'humain' } })
      .expect(200);

    // humain → A (0) et B (0) ; chacune déclenche l'autre, jusqu'à la profondeur maximale.
    const list = await until(
      runs,
      (l) =>
        l.some((r) => r.status === 'skipped') &&
        l.every((r) => !['queued', 'running'].includes(r.status)),
    );
    expect(Math.max(...list.map((r) => r.depth))).toBe(4);
    expect(list.filter((r) => r.status === 'skipped').every((r) => r.depth === 4)).toBe(true);
    expect(list.find((r) => r.status === 'skipped')!.error).toMatch(/boucle probable/);
    expect(list.length).toBeLessThan(20);

    const history = (
      await admin.get(`/v1/acme/submissions/${id}/revisions`).query({ per_page: 100 }).expect(200)
    ).body.data;
    expect(history.filter((r: { automation: unknown }) => r.automation).length).toBeGreaterThan(0);
    expect(
      history.find((r: { automation: { name: string } | null }) => r.automation)!.automation.name,
    ).toMatch(/Pose/);
  });

  it('webhooks : abonnement aux événements, secret montré une fois, désactivation', async () => {
    const created = await admin
      .post('/v1/acme/webhooks')
      .send({
        name: 'n8n',
        url: 'https://n8n.example.ci/webhook/fiches',
        events: ['submission.created', 'submission.state_changed'],
      })
      .expect(201);
    expect(created.body.secret).toMatch(/^whsec_/);
    const listed = (await admin.get('/v1/acme/webhooks').expect(200)).body.data[0];
    expect(listed.secret).toBeUndefined();
    expect(listed.secretHint).toBe(`…${created.body.secret.slice(-4)}`);
    await admin
      .post('/v1/acme/webhooks')
      .send({ name: 'x', url: 'ftp://a.ci', events: [] })
      .expect(400);

    const id = await validFiche(technicien);
    await technicien
      .patch(`/v1/acme/submissions/${id}`)
      .send({ data: { etat: 'degrade' } })
      .expect(200);
    await technicien
      .post(`/v1/acme/submissions/${id}/transition`)
      .send({ transition: 'soumettre' })
      .expect(200);
    const deliveries = (
      await admin.get(`/v1/acme/webhooks/${created.body.id}/deliveries`).expect(200)
    ).body.data;
    // Création et changement d'état ; la simple modification n'est pas abonnée.
    expect(deliveries.map((d: { event: string }) => d.event).sort()).toEqual([
      'submission.created',
      'submission.state_changed',
    ]);
    const payload = await inInstance((tx) =>
      tx.webhookDelivery.findFirstOrThrow({ where: { event: 'submission.state_changed' } }),
    );
    expect(payload.payload).toMatchObject({
      structure: { id: structureId, name: 'Inspection équipement' },
      submission: { id, state: 'soumis' },
      changes: expect.arrayContaining([{ field: '$state', before: 'brouillon', after: 'soumis' }]),
    });

    await admin.patch(`/v1/acme/webhooks/${created.body.id}`).send({ enabled: false }).expect(200);
    await validFiche(technicien);
    expect(
      (await admin.get(`/v1/acme/webhooks/${created.body.id}/deliveries`).expect(200)).body.meta
        .total,
    ).toBe(2);
    const ping = await admin.post(`/v1/acme/webhooks/${created.body.id}/ping`).expect(201);
    expect(ping.body.deliveryId).toBeTruthy();
  });

  it('déclencheur planifié (cron) et relance manuelle d’une exécution en échec', async () => {
    const webhook = await admin
      .post('/v1/acme/webhooks')
      .send({ name: 'Rapport hebdo', url: 'https://hooks.example.ci/hebdo', events: [] })
      .expect(201);
    const scheduled = await admin
      .post('/v1/acme/automations')
      .send({
        name: 'Tournée du lundi',
        trigger: { type: 'schedule', cron: '0 8 * * 1' },
        actions: [
          {
            type: 'create_task',
            structureId,
            title: 'Tournée du {{_date}}',
            assignee: { type: 'user', userId: tenant.users[2]!.id },
            startInDays: 0,
          },
          { type: 'webhook', webhookId: webhook.body.id },
        ],
      })
      .expect(201);
    const schedulers = await queue.getJobSchedulers();
    expect(schedulers.map((s) => s.key)).toContain(`automation-${scheduled.body.id}`);
    expect(schedulers.find((s) => s.key === `automation-${scheduled.body.id}`)).toMatchObject({
      pattern: '0 8 * * 1',
      tz: 'Africa/Abidjan',
    });

    // Une échéance : tâche créée et livraison préparée.
    const runner = app.get(AutomationRunner);
    const runId = await runWithContext({ instanceId: tenant.instance.id }, () =>
      runner.scheduled(tenant.instance.id, scheduled.body.id, 'tick-1'),
    );
    const [ok] = await runs();
    expect(ok).toMatchObject({ id: runId, status: 'succeeded' });
    expect(await inInstance((tx) => tx.task.count())).toBe(1);
    await admin.post(`/v1/acme/automation-runs/${runId}/retry`).expect(409);

    // Webhook supprimé : échec définitif expliqué, puis relance après correction.
    await admin.delete(`/v1/acme/webhooks/${webhook.body.id}`).expect(204);
    const failedId = await runWithContext({ instanceId: tenant.instance.id }, () =>
      runner.scheduled(tenant.instance.id, scheduled.body.id, 'tick-2').catch(() => null),
    );
    const failed = (await runs({ status: 'failed' }))[0]!;
    expect(failedId).toBeNull();
    expect(failed.error).toMatch(/Action 2 \(webhook\) : Webhook introuvable/);
    expect(failed.steps.map((s) => s.status)).toEqual(['done', 'failed']);
    expect(await inInstance((tx) => tx.task.count())).toBe(2);

    const retried = await admin.post(`/v1/acme/automation-runs/${failed.id}/retry`).expect(201);
    expect(retried.body.status).toBe('queued');
    // Rejouée par la file : la tâche déjà créée ne l'est pas une seconde fois.
    await until(
      async () => (await runs()).find((r) => r.id === failed.id)!,
      (run) => run.status === 'failed' && (run as { attempts?: number }).attempts !== 1,
    );
    expect(await inInstance((tx) => tx.task.count())).toBe(2);

    await admin.delete(`/v1/acme/automations/${scheduled.body.id}`).expect(204);
    expect((await queue.getJobSchedulers()).map((s) => s.key)).not.toContain(
      `automation-${scheduled.body.id}`,
    );
  });
});
