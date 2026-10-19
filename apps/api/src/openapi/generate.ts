import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from '../app.module';
import { readControllerComments } from './comments';
export { OPENAPI_FILE } from './openapi-file';
import { buildDocument, collectControllers } from './document';

const API_ROOT = join(__dirname, '..', '..');

/** Texte du document OpenAPI, tel qu'il doit être versionné. */
export function generateOpenApi(): string {
  const { version } = JSON.parse(readFileSync(join(API_ROOT, 'package.json'), 'utf8')) as {
    version: string;
  };
  const document = buildDocument(collectControllers(AppModule), {
    version,
    docs: readControllerComments(join(API_ROOT, 'src')),
  });
  return `${JSON.stringify(document, null, 2)}\n`;
}
