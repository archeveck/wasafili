import { join } from 'node:path';

/** Document OpenAPI versionné à la racine de l'API (`src/` en dev, `dist/` en production). */
export const OPENAPI_FILE = join(__dirname, '..', '..', 'openapi.json');
