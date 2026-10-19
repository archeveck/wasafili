import { Controller, Get, Header, Headers, Inject, NotFoundException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { Public } from '../auth/decorators';
import { ENV, type Env } from '../config/env';
import { OpenApi } from '../openapi/openapi.decorator';
import { HttpMetrics } from './metrics';

/**
 * Métriques Prometheus, hors préfixe `/v1` : non publiées par le proxy (nginx, Traefik), donc
 * lisibles seulement depuis le réseau interne. Avec `METRICS_TOKEN`, un jeton Bearer est exigé
 * en plus.
 */
@Controller('metrics')
@Public()
export class MetricsController {
  constructor(
    private readonly metrics: HttpMetrics,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Métriques au format d'exposition Prometheus. */
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @OpenApi({ produces: ['text/plain'] })
  async read(@Headers('authorization') authorization?: string): Promise<string> {
    const expected = this.env.METRICS_TOKEN;
    if (expected) {
      const given = Buffer.from(authorization ?? '');
      const wanted = Buffer.from(`Bearer ${expected}`);
      // Même réponse qu'une route absente : l'existence de l'endpoint n'est pas révélée.
      if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
        throw new NotFoundException({ error: 'not_found', message: 'Ressource introuvable' });
      }
    }
    return this.metrics.registry.metrics();
  }
}
