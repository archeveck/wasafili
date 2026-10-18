import { execFileSync } from 'node:child_process';
import { loadDotEnv } from '../src/config/dotenv';

/** Applique les migrations sur la base de test (rôle propriétaire) avant la suite d'intégration. */
export default function setup(): void {
  loadDotEnv();
  const ownerUrl = process.env['TEST_DATABASE_OWNER_URL'];
  if (!ownerUrl || !process.env['TEST_DATABASE_URL']) {
    throw new Error('TEST_DATABASE_URL et TEST_DATABASE_OWNER_URL sont requis (voir .env.example)');
  }
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_OWNER_URL: ownerUrl },
    stdio: 'pipe',
  });
}
