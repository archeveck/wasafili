import { loadDotEnv } from '../src/config/dotenv';
import { createPrismaClient } from '../src/prisma/tenant';
import { type SeedUser, seedInstance } from '../src/seed/seed-instance';

/** Mot de passe des comptes de démonstration — développement et démo uniquement. */
export const DEMO_PASSWORD = 'Tesserax2026!';

async function main(): Promise<void> {
  loadDotEnv();
  const url = process.env['DATABASE_OWNER_URL'] ?? process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_OWNER_URL ou DATABASE_URL requis');

  const client = createPrismaClient(url);
  try {
    const { instance, users } = await seedInstance(client, {
      short: 'demo',
      name: 'Démo BTP Abidjan',
      users: (
        [
          { email: 'admin@tesserax.local', firstName: 'Awa', lastName: 'Koné', role: 'admin' },
          {
            email: 'superviseur@tesserax.local',
            firstName: 'Yao',
            lastName: 'Kouassi',
            role: 'superviseur',
          },
          {
            email: 'technicien@tesserax.local',
            firstName: 'Mamadou',
            lastName: 'Traoré',
            role: 'technicien',
          },
        ] satisfies Omit<SeedUser, 'password'>[]
      ).map((user) => ({ ...user, password: DEMO_PASSWORD })),
    });
    console.log(`Instance « ${instance.short} » prête avec ${users.length} utilisateurs.`);
  } finally {
    await client.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
