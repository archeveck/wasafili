import { defineConfig } from 'prisma/config';
import { loadDotEnv } from './src/config/dotenv';

loadDotEnv();

// La CLI (migrations, seed) se connecte avec le rôle propriétaire ; l'application utilise
// DATABASE_URL (rôle applicatif soumis à la RLS). En conteneur, DATABASE_URL suffit.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env['DATABASE_OWNER_URL'] ?? process.env['DATABASE_URL'] ?? '',
  },
});
