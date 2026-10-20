import { Controller, Get, Header } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { Public } from '../auth/decorators';
import { OPENAPI_FILE } from './openapi-file';
import { OpenApi } from './openapi.decorator';

/** CSP de la page de documentation : scripts et styles servis par l'API uniquement. */
const DOCS_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join('; ');

const DOCS_HTML = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>API Wasafili</title>
    <link rel="stylesheet" href="docs/assets/swagger-ui.css" />
  </head>
  <body>
    <div id="api"></div>
    <script src="docs/assets/swagger-ui-bundle.js"></script>
    <script src="docs/init.js"></script>
  </body>
</html>
`;

// Script séparé (pas de script en ligne) : la CSP reste stricte.
const DOCS_INIT = `window.ui = SwaggerUIBundle({
  url: 'openapi.json',
  dom_id: '#api',
  deepLinking: true,
  docExpansion: 'none',
  defaultModelsExpandDepth: 0,
  tryItOutEnabled: false,
});
`;

/** Documentation de l'API : document OpenAPI 3.1 et page interactive. */
@Controller()
@Public()
export class OpenApiController {
  private document?: string;

  /** Document OpenAPI 3.1 de l'API. */
  @Get('openapi.json')
  @Header('Content-Type', 'application/json; charset=utf-8')
  @Header('Cache-Control', 'no-cache')
  @OpenApi({ produces: ['application/json'] })
  openapi(): string {
    this.document ??= readFileSync(OPENAPI_FILE, 'utf8');
    return this.document;
  }

  /** Documentation interactive de l'API. */
  @Get('docs')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Content-Security-Policy', DOCS_CSP)
  @OpenApi({ produces: ['text/html'] })
  docs(): string {
    return DOCS_HTML;
  }

  /** Initialisation de la page de documentation. */
  @Get('docs/init.js')
  @Header('Content-Type', 'text/javascript; charset=utf-8')
  @OpenApi({ produces: ['text/javascript'] })
  init(): string {
    return DOCS_INIT;
  }
}
