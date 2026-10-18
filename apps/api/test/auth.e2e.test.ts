import { type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  api,
  createOAuthClient,
  createTenant,
  createTestApp,
  login,
  owner,
  PASSWORD,
  resetDatabase,
} from './helpers';

let app: INestApplication;
let tenant: Awaited<ReturnType<typeof createTenant>>;

beforeAll(async () => {
  app = await createTestApp();
});

beforeEach(async () => {
  await resetDatabase();
  tenant = await createTenant('acme');
});

afterAll(async () => {
  await app.close();
});

const token = () => request(app.getHttpServer()).post('/v1/oauth/token');

describe('grant password', () => {
  it('émet un jeton d accès court et un refresh token', async () => {
    const res = await token()
      .type('form')
      .send({ grant_type: 'password', username: 'ADMIN@acme.test', password: PASSWORD })
      .expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({ token_type: 'Bearer', expires_in: 900 });
    expect(res.body.access_token).toEqual(expect.any(String));
    expect(res.body.refresh_token).toEqual(expect.any(String));
  });

  it('accepte aussi un corps JSON', async () => {
    await token()
      .send({ grant_type: 'password', username: 'admin@acme.test', password: PASSWORD })
      .expect(200);
  });

  it('répond pareil pour un mauvais mot de passe et un compte inconnu', async () => {
    const wrong = await token()
      .send({ grant_type: 'password', username: 'admin@acme.test', password: 'faux' })
      .expect(400);
    const unknown = await token()
      .send({ grant_type: 'password', username: 'personne@acme.test', password: 'faux' })
      .expect(400);
    expect(wrong.body).toEqual({ error: 'invalid_grant', error_description: expect.any(String) });
    expect(unknown.body).toEqual(wrong.body);
  });

  it('refuse un compte désactivé', async () => {
    await owner().user.update({
      where: { email: 'admin@acme.test' },
      data: { isActive: false },
    });
    const res = await token()
      .send({ grant_type: 'password', username: 'admin@acme.test', password: PASSWORD })
      .expect(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  it('signale un grant non supporté ou une requête incomplète', async () => {
    expect((await token().send({ grant_type: 'implicit' }).expect(400)).body.error).toBe(
      'unsupported_grant_type',
    );
    expect((await token().send({ grant_type: 'password' }).expect(400)).body.error).toBe(
      'invalid_request',
    );
  });
});

describe('jeton d accès', () => {
  it('protège les routes', async () => {
    await api(app).get('/v1/me').expect(401);
    await api(app, 'pas-un-jwt').get('/v1/me').expect(401);
  });

  it('refuse un jeton expiré', async () => {
    const expired = app.get(JwtService).sign({
      sub: tenant.users[0]!.id,
      typ: 'user',
      exp: Math.floor(Date.now() / 1000) - 10,
    });
    const res = await api(app, expired).get('/v1/me').expect(401);
    expect(res.body.error).toBe('invalid_token');
  });

  it('refuse un jeton signé avec un autre secret', async () => {
    const forged = new JwtService({ secret: 'y'.repeat(40) }).sign(
      { sub: tenant.users[0]!.id, typ: 'user' },
      { issuer: 'tesserax' },
    );
    await api(app, forged).get('/v1/me').expect(401);
  });
});

describe('parcours de session', () => {
  it('login → appel protégé → refresh → logout', async () => {
    const first = await login(app, 'admin@acme.test');
    const me = await api(app, first.access_token).get('/v1/me').expect(200);
    expect(me.body).toMatchObject({ kind: 'user', email: 'admin@acme.test' });

    const refreshed = await token()
      .send({ grant_type: 'refresh_token', refresh_token: first.refresh_token })
      .expect(200);
    expect(refreshed.body.refresh_token).not.toBe(first.refresh_token);
    await api(app, refreshed.body.access_token).get('/v1/me').expect(200);

    await request(app.getHttpServer())
      .post('/v1/oauth/revoke')
      .send({ token: refreshed.body.refresh_token })
      .expect(200);
    await token()
      .send({ grant_type: 'refresh_token', refresh_token: refreshed.body.refresh_token })
      .expect(400);
  });

  it('la réutilisation d un refresh token révoque toute la session', async () => {
    const first = await login(app, 'admin@acme.test');
    const second = await token()
      .send({ grant_type: 'refresh_token', refresh_token: first.refresh_token })
      .expect(200);

    // Rejeu de l'ancien jeton (vol présumé) : refusé…
    await token()
      .send({ grant_type: 'refresh_token', refresh_token: first.refresh_token })
      .expect(400);
    // …et le jeton légitime de la même famille est révoqué.
    await token()
      .send({ grant_type: 'refresh_token', refresh_token: second.body.refresh_token })
      .expect(400);

    // Les autres sessions de l'utilisateur ne sont pas affectées.
    const other = await login(app, 'admin@acme.test');
    await token()
      .send({ grant_type: 'refresh_token', refresh_token: other.refresh_token })
      .expect(200);
  });

  it('deux échanges concurrents du même refresh token : un seul réussit', async () => {
    const { refresh_token } = await login(app, 'admin@acme.test');
    const results = await Promise.all(
      [0, 1].map(() => token().send({ grant_type: 'refresh_token', refresh_token })),
    );
    expect(results.map((res) => res.status).sort()).toEqual([200, 400]);
  });

  it('refuse un refresh token expiré', async () => {
    const { refresh_token } = await login(app, 'admin@acme.test');
    await owner().refreshToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await token().send({ grant_type: 'refresh_token', refresh_token }).expect(400);
  });

  it('la révocation d un jeton inconnu répond 200 sans effet', async () => {
    await request(app.getHttpServer())
      .post('/v1/oauth/revoke')
      .send({ token: 'inconnu' })
      .expect(200);
  });
});

describe('grant client_credentials', () => {
  it('authentifie un client par en-tête Basic et applique ses scopes', async () => {
    const { clientId, secret } = await createOAuthClient(tenant.instance.id, ['user:read']);
    const res = await token()
      .auth(clientId, secret)
      .type('form')
      .send({ grant_type: 'client_credentials' })
      .expect(200);
    expect(res.body).toMatchObject({ token_type: 'Bearer', scope: 'user:read' });
    expect(res.body.refresh_token).toBeUndefined();

    const client = api(app, res.body.access_token);
    await client.get('/v1/acme/users').expect(200);
    await client.get('/v1/acme/roles').expect(403);
    expect((await client.get('/v1/me').expect(200)).body).toMatchObject({ kind: 'client' });
  });

  it('accepte les identifiants dans le corps', async () => {
    const { clientId, secret } = await createOAuthClient(tenant.instance.id, []);
    await token()
      .send({ grant_type: 'client_credentials', client_id: clientId, client_secret: secret })
      .expect(200);
  });

  it('refuse un mauvais secret, un client inconnu ou révoqué', async () => {
    const { clientId } = await createOAuthClient(tenant.instance.id, []);
    const revoked = await createOAuthClient(tenant.instance.id, [], { revoked: true });
    for (const [id, secret] of [
      [clientId, 'mauvais'],
      ['inconnu', 'x'],
      [revoked.clientId, revoked.secret],
    ] as const) {
      const res = await token().auth(id, secret).send({ grant_type: 'client_credentials' });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('invalid_client');
    }
  });
});

describe('limitation de débit', () => {
  it('bloque les tentatives de connexion au-delà de la limite', async () => {
    const limited = await createTestApp({ LOGIN_RATE_LIMIT_PER_MINUTE: '3' });
    try {
      const attempt = () =>
        request(limited.getHttpServer())
          .post('/v1/oauth/token')
          .send({ grant_type: 'password', username: 'admin@acme.test', password: 'faux' });
      for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(400);
      expect((await attempt()).status).toBe(429);
    } finally {
      await limited.close();
    }
  });
});
