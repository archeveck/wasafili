import { Injectable } from '@nestjs/common';
import { type NextFunction, type Request, type Response } from 'express';
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';

/**
 * Métriques Prometheus de l'API (P7.2.2) : processus Node et requêtes HTTP, par route
 * déclarée (`/v1/:app/structures`) pour borner la cardinalité.
 */
@Injectable()
export class HttpMetrics {
  readonly registry = new Registry();
  private readonly requests = new Counter({
    name: 'tesserax_http_requests_total',
    help: 'Requêtes HTTP traitées, par méthode, route et code de réponse.',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [this.registry],
  });
  private readonly duration = new Histogram({
    name: 'tesserax_http_request_duration_seconds',
    help: 'Durée des requêtes HTTP, par méthode et route.',
    labelNames: ['method', 'route'] as const,
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });

  constructor() {
    this.registry.setDefaultLabels({ service: 'api' });
    collectDefaultMetrics({ register: this.registry });
  }

  /** Middleware Express : mesure chaque requête à la fin de sa réponse. */
  readonly middleware = (req: Request, res: Response, next: NextFunction): void => {
    const stop = this.duration.startTimer();
    res.once('finish', () => {
      const route = req.route ? `${req.baseUrl}${(req.route as { path: string }).path}` : 'autre';
      if (route === '/metrics' || route.startsWith('/health')) return;
      this.requests.inc({ method: req.method, route, status: String(res.statusCode) });
      stop({ method: req.method, route });
    });
    next();
  };
}
