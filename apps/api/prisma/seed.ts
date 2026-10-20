import { loadDotEnv } from '../src/config/dotenv';
import { createPrismaClient } from '../src/prisma/tenant';
import { seedDemoDashboard } from '../src/seed/seed-dashboard';
import { seedDemoContent } from '../src/seed/seed-demo';
import { seedDemoReports } from '../src/seed/seed-reports';
import { type SeedUser, seedInstance } from '../src/seed/seed-instance';

/** Mot de passe des comptes de démonstration — développement et démo uniquement. */
export const DEMO_PASSWORD = 'Wasafili2026!';

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
          { email: 'admin@wasafili.local', firstName: 'Awa', lastName: 'Koné', role: 'admin' },
          {
            email: 'superviseur@wasafili.local',
            firstName: 'Yao',
            lastName: 'Kouassi',
            role: 'superviseur',
          },
          {
            email: 'technicien@wasafili.local',
            firstName: 'Mamadou',
            lastName: 'Traoré',
            role: 'technicien',
          },
        ] satisfies Omit<SeedUser, 'password'>[]
      ).map((user) => ({ ...user, password: DEMO_PASSWORD })),
    });
    const { list, structure } = await seedDemoContent(client, instance.id);
    console.log(
      `Instance « ${instance.short} » prête : ${users.length} utilisateurs, ` +
        `référentiel « ${list.name} », structure « ${structure.name} ».`,
    );
    const dashboard = await seedDemoDashboard(client, {
      instanceId: instance.id,
      structureId: structure.id,
    });
    console.log(`Tableau de bord « ${dashboard.name} » prêt.`);
    const env = process.env;
    if (env['S3_ENDPOINT'] && env['S3_ACCESS_KEY'] && env['S3_SECRET_KEY']) {
      const { report, automation } = await seedDemoReports(client, {
        instanceId: instance.id,
        structureId: structure.id,
        supervisorId: users.find((u) => u.email === 'superviseur@wasafili.local')!.id,
        s3: {
          endpoint: env['S3_ENDPOINT'],
          region: env['S3_REGION'] ?? 'us-east-1',
          bucket: env['S3_BUCKET'] ?? 'wasafili',
          accessKeyId: env['S3_ACCESS_KEY'],
          secretAccessKey: env['S3_SECRET_KEY'],
        },
      });
      console.log(`Rapport « ${report.name} » et automatisation « ${automation.name} » prêts.`);
    } else {
      console.log('Stockage non configuré (S3_*) : rapport de démonstration non créé.');
    }
  } finally {
    await client.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
