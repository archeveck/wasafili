import { hashPassword } from '../auth/crypto';
import { type PrismaClient, type User } from '../generated/prisma/client';
import { tenantTransaction } from '../prisma/tenant';
import { SYSTEM_ROLES, type SystemRoleKey } from '../tenancy/permissions';

export interface SeedUser {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: SystemRoleKey;
}

export interface SeedInstanceInput {
  short: string;
  name: string;
  users: SeedUser[];
}

/**
 * Crée (ou complète) une instance avec ses rôles système et ses membres. Idempotent : un
 * utilisateur existant garde son mot de passe ; seuls les rôles et adhésions sont alignés.
 */
export async function seedInstance(client: PrismaClient, input: SeedInstanceInput) {
  const instance = await client.instance.upsert({
    where: { short: input.short },
    update: {},
    create: { short: input.short, name: input.name },
  });

  const users: { seed: SeedUser; user: User }[] = [];
  for (const seed of input.users) {
    const email = seed.email.toLowerCase();
    const existing = await client.user.findUnique({ where: { email } });
    users.push({
      seed,
      user:
        existing ??
        (await client.user.create({
          data: {
            email,
            passwordHash: await hashPassword(seed.password),
            firstName: seed.firstName,
            lastName: seed.lastName,
          },
        })),
    });
  }

  const roles = await tenantTransaction(client, { instanceId: instance.id }, async (tx) => {
    const byKey = new Map<SystemRoleKey, string>();
    for (const [key, role] of Object.entries(SYSTEM_ROLES) as [
      SystemRoleKey,
      (typeof SYSTEM_ROLES)[SystemRoleKey],
    ][]) {
      const saved = await tx.role.upsert({
        where: { instanceId_key: { instanceId: instance.id, key } },
        update: { name: role.name, permissions: role.permissions, isSystem: true },
        create: {
          instanceId: instance.id,
          key,
          name: role.name,
          permissions: role.permissions,
          isSystem: true,
        },
      });
      byKey.set(key, saved.id);
    }
    for (const { seed, user } of users) {
      const roleId = byKey.get(seed.role)!;
      await tx.membership.upsert({
        where: { instanceId_userId: { instanceId: instance.id, userId: user.id } },
        update: { roleId },
        create: { instanceId: instance.id, userId: user.id, roleId },
      });
    }
    return byKey;
  });

  return { instance, roles, users: users.map(({ user }) => user) };
}
