/**
 * Régénère `openapi.json` depuis les routes de l'API (P7.1.2) :
 *   pnpm --filter @wasafili/api openapi
 * Le fichier est versionné ; un test unitaire échoue s'il n'est plus à jour.
 */
import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { OPENAPI_FILE, generateOpenApi } from '../src/openapi/generate';

writeFileSync(OPENAPI_FILE, generateOpenApi());
console.log(`OpenAPI écrit : ${OPENAPI_FILE}`);
