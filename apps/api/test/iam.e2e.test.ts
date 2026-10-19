import { type INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, createTenant, createTestApp, login, resetDatabase } from './helpers';

let app: INestApplication;
let tenant: Awaited<ReturnType<typeof createTenant>>;
let admin: ReturnType<typeof api>;
let superviseur: ReturnType<typeof api>;

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
  superviseur = api(app, (await login(app, 'superviseur@acme.test')).access_token);
});

const roleId = (key: string) => tenant.roles.get(key as never)!;

describe('membres', () => {
  it('invite un nouveau compte avec mot de passe provisoire, qui peut se connecter', async () => {
    const res = await admin
      .post('/v1/acme/users')
      .send({
        email: 'Nouveau@Acme.test',
        firstName: 'Ama',
        lastName: 'Yao',
        roleId: roleId('technicien'),
      })
      .expect(201);
    expect(res.body).toMatchObject({ email: 'nouveau@acme.test', role: { key: 'technicien' } });
    await login(app, 'nouveau@acme.test', res.body.temporaryPassword);
  });

  it('rattache un compte existant d une autre instance sans changer son mot de passe', async () => {
    const res = await admin
      .post('/v1/acme/users')
      .send({
        email: 'admin@beta.test',
        firstName: 'X',
        lastName: 'Y',
        roleId: roleId('superviseur'),
      })
      .expect(201);
    expect(res.body.temporaryPassword).toBeUndefined();
    await admin
      .post('/v1/acme/users')
      .send({
        email: 'admin@beta.test',
        firstName: 'X',
        lastName: 'Y',
        roleId: roleId('superviseur'),
      })
      .expect(409);
  });

  it('modifie rôle et attributs, protège le dernier administrateur', async () => {
    const technicien = tenant.users[2]!.id;
    const updated = await admin
      .patch(`/v1/acme/users/${technicien}`)
      .send({ roleId: roleId('superviseur'), attributes: { site: 'S-PLT' } })
      .expect(200);
    expect(updated.body).toMatchObject({
      role: { key: 'superviseur' },
      attributes: { site: 'S-PLT' },
    });

    const self = tenant.users[0]!.id;
    expect(
      (
        await admin
          .patch(`/v1/acme/users/${self}`)
          .send({ roleId: roleId('technicien') })
          .expect(409)
      ).body.error,
    ).toBe('last_admin');
    await admin.delete(`/v1/acme/users/${self}`).expect(403);

    await admin.delete(`/v1/acme/users/${technicien}`).expect(204);
    await admin.get(`/v1/acme/users/${technicien}`).expect(404);
  });

  it('réserve la gestion des membres à user:manage', async () => {
    await superviseur.get('/v1/acme/users').expect(200);
    await superviseur
      .post('/v1/acme/users')
      .send({ email: 'x@acme.test', firstName: 'X', lastName: 'Y', roleId: roleId('admin') })
      .expect(403);
    await superviseur
      .patch(`/v1/acme/users/${tenant.users[1]!.id}`)
      .send({ roleId: roleId('admin') })
      .expect(403);
  });
});

describe('rôles', () => {
  it('crée, modifie et supprime un rôle personnalisé', async () => {
    const role = await admin
      .post('/v1/acme/roles')
      .send({ key: 'auditeur', name: 'Auditeur', permissions: ['audit:read', 'structure:read'] })
      .expect(201);
    await admin
      .patch(`/v1/acme/roles/${role.body.id}`)
      .send({ permissions: ['audit:read'] })
      .expect(200);
    await admin
      .post('/v1/acme/roles')
      .send({ key: 'x', name: 'X', permissions: ['inconnue'] })
      .expect(400);
    await admin.delete(`/v1/acme/roles/${role.body.id}`).expect(204);
    expect((await admin.get('/v1/acme/roles/permissions').expect(200)).body.data).toContain(
      'audit:read',
    );
  });

  it('protège les rôles système et les rôles attribués', async () => {
    await admin
      .patch(`/v1/acme/roles/${roleId('admin')}`)
      .send({ permissions: [] })
      .expect(403);
    await admin.delete(`/v1/acme/roles/${roleId('technicien')}`).expect(403);
    const role = await admin
      .post('/v1/acme/roles')
      .send({ key: 'chef', name: 'Chef', permissions: [] })
      .expect(201);
    await admin
      .patch(`/v1/acme/users/${tenant.users[2]!.id}`)
      .send({ roleId: role.body.id })
      .expect(200);
    await admin.delete(`/v1/acme/roles/${role.body.id}`).expect(409);
  });
});

describe('groupes', () => {
  it('gère les membres d un groupe, limités aux membres de l instance', async () => {
    const group = await admin.post('/v1/acme/groups').send({ name: 'Équipe nord' }).expect(201);
    const members = await admin
      .put(`/v1/acme/groups/${group.body.id}/members`)
      .send({ userIds: [tenant.users[1]!.id, tenant.users[2]!.id] })
      .expect(200);
    expect(members.body.data).toHaveLength(2);
    const detail = await admin.get(`/v1/acme/groups/${group.body.id}`).expect(200);
    expect(detail.body.members).toHaveLength(2);
    const users = await admin.get('/v1/acme/users').expect(200);
    expect(
      users.body.data.find((u: { id: string }) => u.id === tenant.users[2]!.id).groups,
    ).toEqual([{ id: group.body.id, name: 'Équipe nord' }]);

    const beta = await login(app, 'admin@beta.test');
    const betaMe = await api(app, beta.access_token).get('/v1/me').expect(200);
    await admin
      .put(`/v1/acme/groups/${group.body.id}/members`)
      .send({ userIds: [betaMe.body.id] })
      .expect(400);

    await admin.patch(`/v1/acme/groups/${group.body.id}`).send({ name: 'Équipe sud' }).expect(200);
    await admin.delete(`/v1/acme/groups/${group.body.id}`).expect(204);
  });
});

describe('réinitialisation de mot de passe par un administrateur (ASVS 2.5)', () => {
  const memberId = async (email: string) => {
    const res = await admin.get('/v1/acme/users?per_page=100').expect(200);
    return (res.body.data as { id: string; email: string }[]).find((m) => m.email === email)!.id;
  };

  it('renvoie un mot de passe provisoire et ferme les sessions du membre', async () => {
    const before = await login(app, 'technicien@acme.test');
    const id = await memberId('technicien@acme.test');
    await superviseur.post(`/v1/acme/users/${id}/password-reset`).expect(403);

    const res = await admin.post(`/v1/acme/users/${id}/password-reset`).expect(200);
    expect(res.body.temporaryPassword).toHaveLength(16);
    await api(app)
      .post('/v1/oauth/token')
      .send({ grant_type: 'refresh_token', refresh_token: before.refresh_token })
      .expect(400);
    await login(app, 'technicien@acme.test', res.body.temporaryPassword as string);

    const self = await memberId('admin@acme.test');
    await admin.post(`/v1/acme/users/${self}/password-reset`).expect(400);
  });

  it('refuse pour un compte qui appartient aussi à une autre instance', async () => {
    const betaAdmin = api(app, (await login(app, 'admin@beta.test')).access_token);
    const roles = await betaAdmin.get('/v1/beta/roles?per_page=100').expect(200);
    const roleId = (roles.body.data as { id: string; key: string }[]).find(
      (r) => r.key === 'technicien',
    )!.id;
    await betaAdmin
      .post('/v1/beta/users')
      .send({ email: 'technicien@acme.test', firstName: 'T', lastName: 'A', roleId })
      .expect(201);

    const id = await memberId('technicien@acme.test');
    const refused = await admin.post(`/v1/acme/users/${id}/password-reset`).expect(409);
    expect(refused.body.error).toBe('shared_account');
  });
});
