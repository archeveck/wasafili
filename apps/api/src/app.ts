import { type NestExpressApplication } from '@nestjs/platform-express';
import { type NextFunction, type Request, type Response } from 'express';
import { Logger } from 'nestjs-pino';
import { getAbsoluteFSPath } from 'swagger-ui-dist';
import { requestContextMiddleware } from './common/request-context';
import { type Env } from './config/env';
import { HttpMetrics } from './health/metrics';

/**
 * En-têtes de sécurité de toute réponse de l'API (P7.4.2) : JSON jamais interprété ni mis en
 * cache. La page de documentation pose sa propre CSP.
 */
function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store');
  next();
}

/** Configuration HTTP commune au serveur et aux tests d'intégration. */
export function configureApp(app: NestExpressApplication, env: Env): NestExpressApplication {
  app.useLogger(app.get(Logger));
  app.use(app.get(HttpMetrics).middleware);
  app.use(requestContextMiddleware);
  app.use(securityHeaders);
  // Sondes et métriques d'exploitation hors API versionnée.
  app.setGlobalPrefix('v1', { exclude: ['health', 'health/live', 'metrics'] });
  // Fichiers statiques de Swagger UI (page `/v1/docs`).
  app.useStaticAssets(getAbsoluteFSPath(), { prefix: '/v1/docs/assets/', index: false });
  // CORS fermé par défaut : le back-office est servi sous la même origine que l'API ; seules
  // les origines listées dans CORS_ORIGINS (intégrations navigateur) sont admises.
  app.enableCors({
    origin: env.CORS_ORIGINS,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
    exposedHeaders: [
      'RateLimit-Limit',
      'RateLimit-Remaining',
      'RateLimit-Reset',
      'Retry-After',
      'X-Request-Id',
      'Content-Disposition',
    ],
    maxAge: 600,
  });
  app.disable('x-powered-by');
  // Pas d'ETag : une API (et surtout la synchronisation) ne doit pas répondre 304 depuis un cache.
  app.set('etag', false);
  if (env.TRUST_PROXY > 0) app.set('trust proxy', env.TRUST_PROXY);
  app.enableShutdownHooks();
  return app;
}
