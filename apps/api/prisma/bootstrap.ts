import { loadDotEnv } from '../src/config/dotenv';
import { createPrismaClient } from '../src/prisma/tenant';
import { parseBootstrapEnv } from '../src/seed/bootstrap';
import { seedInstance } from '../src/seed/seed-instance';

/**
 * Amorçage d'une installation réelle : première instance et son administrateur, sans aucune
 * donnée de démonstration. Idempotent : relancé, il n'écrase ni l'instance ni un compte existant.
 */
async function main(): Promise<void> {
  loadDotEnv();
  const url = process.env['DATABASE_OWNER_URL'] ?? process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_OWNER_URL ou DATABASE_URL requis');
  const { input, generatedPassword } = parseBootstrapEnv(process.env);
  const admin = input.users[0]!;

  const client = createPrismaClient(url);
  try {
    const existing = await client.user.findUnique({ where: { email: admin.email.toLowerCase() } });
    const { instance } = await seedInstance(client, input);
    console.log(`Instance « ${instance.short} » (${instance.name}) prête.`);
    if (existing) {
      console.log(
        `${admin.email} : compte existant, administrateur de l'instance, mot de passe inchangé.`,
      );
    } else if (generatedPassword) {
      console.log(
        `${admin.email} : mot de passe initial (affiché une seule fois) : ${admin.password}`,
      );
    } else {
      console.log(`${admin.email} : compte créé avec le mot de passe fourni.`);
    }
  } finally {
    await client.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
