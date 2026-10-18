import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { currentContext, type RequestContext, runWithContext } from '../src/common/request-context';
import { type PrismaClient } from '../src/generated/prisma/client';
import { createPrismaClient, tenantTransaction, withTenantContext } from '../src/prisma/tenant';
import { createTenant, owner, resetDatabase, TEST_DATABASE_URL } from './helpers';

/**
 * Isolation au niveau base (ADR 0001), avec le rôle applicatif et sans les guards HTTP :
 * un oubli de filtre dans le code ne doit jamais faire fuir de données.
 */
let base: PrismaClient;
let db: ReturnType<typeof withTenantContext>;
let a: Awaited<ReturnType<typeof createTenant>>;
let b: Awaited<ReturnType<typeof createTenant>>;
let groupB: { id: string };

const as = <T>(context: RequestContext, fn: () => Promise<T>) => runWithContext(context, fn);

beforeAll(() => {
  base = createPrismaClient(TEST_DATABASE_URL);
  db = withTenantContext(base, currentContext);
});

afterAll(async () => {
  await base.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  a = await createTenant('alpha');
  b = await createTenant('beta');
  await tenantTransaction(owner(), { instanceId: a.instance.id }, (tx) =>
    tx.group.create({ data: { instanceId: a.instance.id, name: 'Équipe A' } }),
  );
  groupB = await tenantTransaction(owner(), { instanceId: b.instance.id }, (tx) =>
    tx.group.create({ data: { instanceId: b.instance.id, name: 'Équipe B' } }),
  );
});

describe('configuration de la base', () => {
  it('le rôle applicatif ne contourne pas la RLS et ne possède aucune table', async () => {
    const [role] = await base.$queryRaw<{ rolbypassrls: boolean; rolsuper: boolean }[]>`
      SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`;
    expect(role).toEqual({ rolbypassrls: false, rolsuper: false });
    const owned = await base.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user`;
    expect(owned).toEqual([]);
  });

  it('toute table portant instance_id a la RLS activée et forcée', async () => {
    const tables = await base.$queryRaw<{ table: string; enabled: boolean; forced: boolean }[]>`
      SELECT c.table_name AS table, k.relrowsecurity AS enabled, k.relforcerowsecurity AS forced
      FROM information_schema.columns c
      JOIN pg_class k ON k.relname = c.table_name AND k.relnamespace = 'public'::regnamespace
      WHERE c.table_schema = 'public' AND c.column_name = 'instance_id'`;
    expect(tables.length).toBeGreaterThanOrEqual(5);
    for (const table of tables) {
      expect(table, table.table).toMatchObject({ enabled: true, forced: true });
    }
  });
});

describe('lecture', () => {
  it('sans contexte, aucune ligne n est visible', async () => {
    expect(await db.role.count()).toBe(0);
    expect(await db.group.count()).toBe(0);
    expect(await db.membership.count()).toBe(0);
    expect(await db.oAuthClient.count()).toBe(0);
  });

  it('dans une instance, seules ses lignes sont visibles (lecture, listing, comptage)', async () => {
    await as({ instanceId: a.instance.id }, async () => {
      expect((await db.group.findMany()).map((group) => group.name)).toEqual(['Équipe A']);
      expect(await db.group.findUnique({ where: { id: groupB.id } })).toBeNull();
      expect(await db.role.count()).toBe(3);
      expect(await db.membership.count()).toBe(3);
    });
  });

  it('les requêtes brutes sans contexte ne voient rien non plus', async () => {
    const rows = await base.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM groups`;
    expect(rows[0]!.count).toBe(0n);
  });
});

describe('écriture', () => {
  it('interdit d insérer une ligne pour une autre instance', async () => {
    await expect(
      as({ instanceId: a.instance.id }, () =>
        db.group.create({ data: { instanceId: b.instance.id, name: 'Intrusion' } }),
      ),
    ).rejects.toThrow();
  });

  it('interdit d insérer sans contexte', async () => {
    await expect(
      db.group.create({ data: { instanceId: a.instance.id, name: 'Sans contexte' } }),
    ).rejects.toThrow();
  });

  it('ne modifie ni ne supprime les lignes d une autre instance', async () => {
    await as({ instanceId: a.instance.id }, async () => {
      expect(
        (await db.group.updateMany({ where: { id: groupB.id }, data: { name: 'Piraté' } })).count,
      ).toBe(0);
      expect((await db.group.deleteMany({ where: { id: groupB.id } })).count).toBe(0);
    });
    const intact = await tenantTransaction(owner(), { instanceId: b.instance.id }, (tx) =>
      tx.group.findUnique({ where: { id: groupB.id } }),
    );
    expect(intact?.name).toBe('Équipe B');
  });

  it('interdit de rattacher un membre à un rôle d une autre instance (FK composite)', async () => {
    const roleB = b.roles.get('admin')!;
    const userA = a.users[2]!;
    await expect(
      tenantTransaction(owner(), { instanceId: a.instance.id }, (tx) =>
        tx.membership.update({
          where: { instanceId_userId: { instanceId: a.instance.id, userId: userA.id } },
          data: { roleId: roleB },
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('adhésions de l utilisateur courant', () => {
  beforeEach(async () => {
    // L'admin de alpha est aussi technicien dans beta.
    await tenantTransaction(owner(), { instanceId: b.instance.id }, (tx) =>
      tx.membership.create({
        data: {
          instanceId: b.instance.id,
          userId: a.users[0]!.id,
          roleId: b.roles.get('technicien')!,
        },
      }),
    );
  });

  it('hors instance, l utilisateur voit ses adhésions et seulement les siennes', async () => {
    const memberships = await as({ userId: a.users[0]!.id }, () => db.membership.findMany());
    expect(memberships.map((m) => m.instanceId).sort()).toEqual(
      [a.instance.id, b.instance.id].sort(),
    );
    expect(memberships.every((m) => m.userId === a.users[0]!.id)).toBe(true);
  });

  it('dans une instance, ses adhésions aux autres instances restent invisibles', async () => {
    const memberships = await as({ instanceId: a.instance.id, userId: a.users[0]!.id }, () =>
      db.membership.findMany(),
    );
    expect(memberships).toHaveLength(3);
    expect(memberships.every((m) => m.instanceId === a.instance.id)).toBe(true);
  });

  it('la lecture élargie ne permet aucune écriture', async () => {
    await expect(
      as({ userId: a.users[0]!.id }, () =>
        db.membership.deleteMany({ where: { userId: a.users[0]!.id } }),
      ),
    ).resolves.toEqual({ count: 0 });
  });
});
