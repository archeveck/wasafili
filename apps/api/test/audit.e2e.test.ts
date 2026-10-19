import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sanitizeMetadata } from '../src/audit/audit.service';
import { runWithContext } from '../src/common/request-context';
import { createPrismaClient, withTenantContext } from '../src/prisma/tenant';
import { currentContext } from '../src/common/request-context';
import {
  api,
  createDemoTenant,
  createOAuthClient,
  createTenant,
  createTestApp,
  login,
  resetDatabase,
  TEST_DATABASE_URL,
} from './helpers';

let app: INestApplication;
let tenant: Awaited<ReturnType<typeof createDemoTenant>>;
let admin: ReturnType<typeof api>;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase();
  tenant = await createDemoTenant('acme');
  await createTenant('beta');
  admin = api(app, (await login(app, 'admin@acme.test')).access_token);
});

type Entry = {
  action: string;
  actorLabel: string | null;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
};

async function entries(query = ''): Promise<Entry[]> {
  const res = await admin.get(`/v1/acme/audit-logs?per_page=100${query}`).expect(200);
  return res.body.data as Entry[];
}

/** Les refus de connexion sont journalisés sans être attendus (pas d'écart de temps de réponse). */
async function eventually(query: string, count = 1): Promise<Entry[]> {
  for (let i = 0; i < 50; i += 1) {
    const found = await entries(query);
    if (found.length >= count) return found;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Aucune entrée pour ${query}`);
}

describe('journal d audit', () => {
  it('trace les connexions réussies et refusées, dans chaque instance du compte', async () => {
    const logins = await entries('&action=auth.login');
    expect(logins[0]).toMatchObject({ actorLabel: 'admin@acme.test', ip: expect.any(String) });

    await request(app.getHttpServer())
      .post('/v1/oauth/token')
      .type('form')
      .send({ grant_type: 'password', username: 'technicien@acme.test', password: 'faux' })
      .expect(400);
    const [failed] = await eventually('&action=auth.login_failed');
    expect(failed).toMatchObject({
      actorLabel: 'technicien@acme.test',
      metadata: { reason: 'invalid_password' },
    });

    // L'instance beta ne voit aucune connexion d'acme.
    const beta = api(app, (await login(app, 'admin@beta.test')).access_token);
    const betaLogins = (await beta.get('/v1/beta/audit-logs?action=auth.').expect(200)).body.data;
    expect(betaLogins.map((e: Entry) => e.actorLabel)).toEqual(['admin@beta.test']);
  });

  it('trace l usage d une clé API et ses refus', async () => {
    const { clientId, secret } = await createOAuthClient(tenant.instance.id, ['structure:read']);
    await request(app.getHttpServer())
      .post('/v1/oauth/token')
      .send({ grant_type: 'client_credentials', client_id: clientId, client_secret: secret })
      .expect(200);
    await request(app.getHttpServer())
      .post('/v1/oauth/token')
      .send({ grant_type: 'client_credentials', client_id: clientId, client_secret: 'faux' })
      .expect(401);
    expect(await entries('&action=auth.client_token')).toEqual([
      expect.objectContaining({ actorLabel: 'Intégration de test' }),
    ]);
    await eventually('&action=auth.client_token_failed');
  });

  it('trace les actions d administration, secrets masqués, après leur succès seulement', async () => {
    const role = await admin
      .post('/v1/acme/roles')
      .send({ key: 'auditeur', name: 'Auditeur', permissions: ['audit:read'] })
      .expect(201);
    await admin
      .patch(`/v1/acme/roles/${role.body.id}`)
      .send({ permissions: ['audit:read', 'user:read'] })
      .expect(200);
    // Refusée (validation) : rien n'est journalisé.
    await admin.patch(`/v1/acme/roles/${role.body.id}`).send({}).expect(400);
    const webhook = await admin
      .post('/v1/acme/webhooks')
      .send({ name: 'ERP', url: 'https://erp.example.com/hook', events: ['submission.created'] })
      .expect(201);
    await admin.post(`/v1/acme/webhooks/${webhook.body.id}/secret`).expect(201);

    const roleEntries = await entries('&action=role.');
    expect(roleEntries.map((e) => e.action)).toEqual(['role.update', 'role.create']);
    expect(roleEntries[0]).toMatchObject({
      targetType: 'role',
      targetId: role.body.id,
      targetLabel: 'Auditeur',
      metadata: { permissions: ['audit:read', 'user:read'] },
    });
    const filtered = await entries(`&target_id=${webhook.body.id}`);
    expect(filtered.map((e) => e.action)).toEqual(['webhook.secret', 'webhook.create']);
    expect(JSON.stringify(filtered)).not.toContain(webhook.body.secret);
  });

  it('trace les exports avec les filtres appliqués', async () => {
    await admin
      .get(`/v1/acme/structures/${tenant.structure.id}/submissions/export?format=csv&state=valide`)
      .expect(200);
    const [entry] = await entries('&action=submission.export');
    expect(entry).toMatchObject({
      targetType: 'structure',
      targetId: tenant.structure.id,
      metadata: { format: 'csv', state: 'valide' },
    });
  });

  it('est réservé à la permission audit:read', async () => {
    const technicien = api(app, (await login(app, 'technicien@acme.test')).access_token);
    await technicien.get('/v1/acme/audit-logs').expect(403);
  });

  it('est immuable pour le rôle applicatif', async () => {
    const base = createPrismaClient(TEST_DATABASE_URL);
    const db = withTenantContext(base, currentContext);
    try {
      await runWithContext({ instanceId: tenant.instance.id }, async () => {
        expect(await db.auditLog.count()).toBeGreaterThan(0);
        expect((await db.auditLog.updateMany({ data: { action: 'x' } })).count).toBe(0);
        expect((await db.auditLog.deleteMany({})).count).toBe(0);
      });
    } finally {
      await base.$disconnect();
    }
  });
});

describe('sanitizeMetadata', () => {
  it('masque les secrets et résume un contenu trop volumineux', () => {
    expect(sanitizeMetadata({ password: 'x', nested: { clientSecret: 'y', ok: 1 } })).toEqual({
      password: '[masqué]',
      nested: { clientSecret: '[masqué]', ok: 1 },
    });
    expect(
      sanitizeMetadata({ big: 'a'.repeat(400), other: Array(30).fill('b'.repeat(400)) }),
    ).toMatchObject({ truncated: true, keys: ['big', 'other'] });
    expect(sanitizeMetadata(undefined)).toEqual({});
  });
});
