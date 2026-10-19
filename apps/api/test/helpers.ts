import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, expect } from 'vitest';
import { configureApp } from '../src/app';
import { randomToken, sha256 } from '../src/auth/crypto';
import { AppModule } from '../src/app.module';
import { loadDotEnv } from '../src/config/dotenv';
import { ENV, type Env } from '../src/config/env';
import { type PrismaClient } from '../src/generated/prisma/client';
import { createPrismaClient, tenantTransaction } from '../src/prisma/tenant';
import { seedDemoContent } from '../src/seed/seed-demo';
import { seedInstance, type SeedUser } from '../src/seed/seed-instance';
import { type SystemRoleKey } from '../src/tenancy/permissions';
import { contractViolations, ResponseContractInterceptor } from './contract';

loadDotEnv();
export const TEST_DATABASE_URL = process.env['TEST_DATABASE_URL']!;
export const TEST_DATABASE_OWNER_URL = process.env['TEST_DATABASE_OWNER_URL']!;
export const PASSWORD = 'Motdepasse#Test1';
export const TEST_QUEUE_PREFIX = 'tesserax-test';

/** Application complète branchée sur la base de test, avec le rôle applicatif (RLS active). */
export async function createTestApp(env: Record<string, string> = {}): Promise<INestApplication> {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: TEST_DATABASE_URL,
    LOGIN_RATE_LIMIT_PER_MINUTE: '1000',
    // Files isolées : un worker de développement ne doit pas consommer les jobs des tests.
    QUEUE_PREFIX: TEST_QUEUE_PREFIX,
    ...env,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  configureApp(app, app.get<Env>(ENV));
  app.useGlobalInterceptors(new ResponseContractInterceptor(app.get(Reflector)));
  await app.init();
  return app;
}

// Toute réponse documentée non conforme à son schéma OpenAPI fait échouer le fichier de tests.
afterAll(() => {
  expect(contractViolations).toEqual([]);
});

let ownerClient: PrismaClient | undefined;

/** Client propriétaire (fixtures uniquement) — soumis lui aussi à FORCE ROW LEVEL SECURITY. */
export function owner(): PrismaClient {
  ownerClient ??= createPrismaClient(TEST_DATABASE_OWNER_URL);
  return ownerClient;
}

/** Vide toutes les tables (TRUNCATE n'est pas soumis à la RLS). */
export async function resetDatabase(): Promise<void> {
  const tables = await owner().$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map(({ tablename }) => `"${tablename}"`).join(', ');
  await owner().$executeRawUnsafe(`TRUNCATE ${list} CASCADE`);
}

/** Instance de test avec un utilisateur par rôle système : `<role>@<short>.test`. */
export async function createTenant(short: string) {
  const users: SeedUser[] = (['admin', 'superviseur', 'technicien'] as SystemRoleKey[]).map(
    (role) => ({
      email: `${role}@${short}.test`,
      password: PASSWORD,
      firstName: role,
      lastName: short,
      role,
    }),
  );
  return seedInstance(owner(), { short, name: `Instance ${short}`, users });
}

export interface Tokens {
  access_token: string;
  refresh_token: string;
}

export async function login(
  app: INestApplication,
  email: string,
  password = PASSWORD,
): Promise<Tokens> {
  const res = await request(app.getHttpServer())
    .post('/v1/oauth/token')
    .type('form')
    .send({ grant_type: 'password', username: email, password })
    .expect(200);
  return res.body as Tokens;
}

export function api(app: INestApplication, token?: string) {
  const server = app.getHttpServer();
  const auth = (req: request.Test) => (token ? req.set('Authorization', `Bearer ${token}`) : req);
  return {
    get: (url: string) => auth(request(server).get(url)),
    post: (url: string) => auth(request(server).post(url)),
    put: (url: string) => auth(request(server).put(url)),
    patch: (url: string) => auth(request(server).patch(url)),
    delete: (url: string) => auth(request(server).delete(url)),
  };
}

/** Client OAuth `client_credentials` de test ; renvoie le secret en clair. */
export async function createOAuthClient(
  instanceId: string,
  scopes: string[],
  options: { revoked?: boolean } = {},
) {
  const clientId = `client_${randomToken().slice(0, 12)}`;
  const secret = randomToken();
  await tenantTransaction(owner(), { instanceId }, (tx) =>
    tx.oAuthClient.create({
      data: {
        instanceId,
        clientId,
        secretHash: sha256(secret),
        name: 'Intégration de test',
        scopes,
        revokedAt: options.revoked ? new Date() : null,
      },
    }),
  );
  return { clientId, secret };
}

/** Instance de test avec le référentiel et la structure de démonstration publiée. */
export async function createDemoTenant(short: string) {
  const tenant = await createTenant(short);
  const demo = await seedDemoContent(owner(), tenant.instance.id);
  return { ...tenant, ...demo };
}

/** Éléments du référentiel de démonstration, par code. */
export async function demoItems(instanceId: string): Promise<Record<string, string>> {
  const items = await tenantTransaction(owner(), { instanceId }, (tx) => tx.listItem.findMany());
  return Object.fromEntries(items.map((item) => [item.code!, item.id]));
}
