import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Charge `.env` (dossier courant puis racine du monorepo) hors production.
 * Les variables déjà présentes dans l'environnement ne sont pas écrasées.
 */
export function loadDotEnv(): void {
  if (process.env['NODE_ENV'] === 'production') return;
  for (const file of ['.env', '../../.env']) {
    const path = resolve(process.cwd(), file);
    if (existsSync(path)) process.loadEnvFile(path);
  }
}
