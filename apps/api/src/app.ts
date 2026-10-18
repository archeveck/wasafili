import { type NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { requestContextMiddleware } from './common/request-context';
import { type Env } from './config/env';

/** Configuration HTTP commune au serveur et aux tests d'intégration. */
export function configureApp(app: NestExpressApplication, env: Env): NestExpressApplication {
  app.useLogger(app.get(Logger));
  app.use(requestContextMiddleware);
  app.setGlobalPrefix('v1', { exclude: ['health'] });
  app.enableCors({ origin: env.CORS_ORIGINS });
  app.disable('x-powered-by');
  if (env.TRUST_PROXY > 0) app.set('trust proxy', env.TRUST_PROXY);
  app.enableShutdownHooks();
  return app;
}
