import { type INestApplication } from '@nestjs/common';
import { type AccountEmailJob, QUEUE_NAME } from '@wasafili/jobs';
import { Queue } from 'bullmq';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  api,
  createTenant,
  createTestApp,
  login,
  owner,
  PASSWORD,
  resetDatabase,
  TEST_QUEUE_PREFIX,
} from './helpers';

let app: INestApplication;
let queue: Queue;

const NEW_PASSWORD = 'Nouveau#motdepasse2026';
const EMAIL = 'technicien@acme.test';

beforeAll(async () => {
  app = await createTestApp();
  queue = new Queue(QUEUE_NAME, {
    connection: { url: process.env['REDIS_URL']! },
    prefix: TEST_QUEUE_PREFIX,
  });
});

beforeEach(async () => {
  await resetDatabase();
  await createTenant('acme');
});

afterAll(async () => {
  await queue.close();
  await app.close();
});

const server = () => request(app.getHttpServer());
const ask = (email: string) => server().post('/v1/password-reset').send({ email });
const confirm = (token: string, password = NEW_PASSWORD) =>
  server().post('/v1/password-reset/confirm').send({ token, password });

/** Attend la demande traitée en arrière-plan ; renvoie le jeton lu dans l'e-mail en file. */
async function tokenSentTo(email: string): Promise<string> {
  const row = await vi.waitFor(
    async () => {
      const found = await owner().passwordResetToken.findFirst({
        where: { user: { email }, usedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      expect(found).not.toBeNull();
      return found!;
    },
    { timeout: 5_000 },
  );
  const job = await vi.waitFor(
    async () => {
      const found = await queue.getJob(`account-email-${row.id}`);
      expect(found).toBeDefined();
      return found!;
    },
    { timeout: 5_000 },
  );
  const data = job.data as AccountEmailJob;
  expect(data.to).toBe(email);
  const match = /\/mot-de-passe\/nouveau#token=([\w-]+)/.exec(data.text);
  expect(match, 'lien dans l’e-mail').not.toBeNull();
  expect(data.html).toContain(match![0]);
  return match![1]!;
}

describe('demande de réinitialisation', () => {
  it('répond pareil pour un compte existant et un e-mail inconnu', async () => {
    const known = await ask(EMAIL.toUpperCase()).expect(202);
    const unknown = await ask('personne@acme.test').expect(202);
    expect(known.headers['cache-control']).toBe('no-store');
    expect(known.text).toBe('');
    expect(unknown.text).toBe(known.text);
    await tokenSentTo(EMAIL);
    expect(await owner().passwordResetToken.count()).toBe(1);
  });

  it('ne stocke que l’empreinte du jeton, valable 30 minutes', async () => {
    await ask(EMAIL).expect(202);
    const token = await tokenSentTo(EMAIL);
    const row = await owner().passwordResetToken.findFirstOrThrow();
    expect(row.tokenHash).not.toContain(token);
    const minutes = (row.expiresAt.getTime() - row.createdAt.getTime()) / 60_000;
    expect(minutes).toBeCloseTo(30, 0);
  });

  it('n’envoie pas deux e-mails en rafale pour le même compte', async () => {
    await ask(EMAIL).expect(202);
    await tokenSentTo(EMAIL);
    await ask(EMAIL).expect(202);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await owner().passwordResetToken.count()).toBe(1);
  });

  it('ignore un compte désactivé', async () => {
    await owner().user.update({ where: { email: EMAIL }, data: { isActive: false } });
    await ask(EMAIL).expect(202);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await owner().passwordResetToken.count()).toBe(0);
  });

  it('une nouvelle demande remplace la précédente', async () => {
    await ask(EMAIL).expect(202);
    const first = await tokenSentTo(EMAIL);
    // Sortie du délai entre deux envois.
    await owner().passwordResetToken.updateMany({
      data: { createdAt: new Date(Date.now() - 10 * 60_000) },
    });
    await ask(EMAIL).expect(202);
    await vi.waitFor(async () => expect(await owner().passwordResetToken.count()).toBe(2));
    const second = await tokenSentTo(EMAIL);
    expect(second).not.toBe(first);
    await confirm(first).expect(400);
    await confirm(second).expect(204);
  });

  it('refuse une requête sans e-mail', async () => {
    const res = await server().post('/v1/password-reset').send({}).expect(400);
    expect(res.body.error).toBe('validation_failed');
  });
});

describe('nouveau mot de passe', () => {
  it('remplace le mot de passe, ferme les sessions et consomme le lien', async () => {
    const session = await login(app, EMAIL);
    await ask(EMAIL).expect(202);
    const token = await tokenSentTo(EMAIL);

    await confirm(token).expect(204);
    const row = await owner().passwordResetToken.findFirstOrThrow({
      where: { usedAt: { not: null } },
    });
    const notice = await queue.getJob(`account-email-${row.id}-done`);
    expect(notice?.data).toMatchObject({ to: EMAIL, subject: 'Votre mot de passe a été changé' });
    expect((notice?.data as AccountEmailJob).text).not.toContain('token=');

    await server()
      .post('/v1/oauth/token')
      .send({ grant_type: 'password', username: EMAIL, password: PASSWORD })
      .expect(400);
    await login(app, EMAIL, NEW_PASSWORD);
    await server()
      .post('/v1/oauth/token')
      .send({ grant_type: 'refresh_token', refresh_token: session.refresh_token })
      .expect(400);
    const reused = await confirm(token, 'Encore#unautre2026').expect(400);
    expect(reused.body.error).toBe('invalid_token');
  });

  it('applique la politique de mot de passe', async () => {
    await ask(EMAIL).expect(202);
    const token = await tokenSentTo(EMAIL);
    const res = await confirm(token, 'court').expect(400);
    expect(res.body.error).toBe('validation_failed');
    // Le lien reste utilisable après un refus de validation.
    await confirm(token).expect(204);
  });

  it('refuse un lien expiré ou inconnu', async () => {
    await ask(EMAIL).expect(202);
    const token = await tokenSentTo(EMAIL);
    await owner().passwordResetToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1) } });
    expect((await confirm(token).expect(400)).body.error).toBe('invalid_token');
    expect((await confirm('inconnu').expect(400)).body.error).toBe('invalid_token');
  });

  it('trace la demande et la réinitialisation dans le journal de l’instance', async () => {
    await ask(EMAIL).expect(202);
    await confirm(await tokenSentTo(EMAIL)).expect(204);
    const { access_token } = await login(app, 'admin@acme.test');
    const res = await api(app, access_token)
      // Préfixe (action inconnue) : couvre la demande et la réinitialisation.
      .get('/v1/acme/audit-logs?action=auth.password_res')
      .expect(200);
    const actions = (res.body.data as { action: string }[]).map((entry) => entry.action);
    expect(actions.sort()).toEqual(['auth.password_reset', 'auth.password_reset_request']);
  });
});
