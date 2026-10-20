import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Request, type Response } from 'express';
import { ENV, type Env } from '../config/env';
import { type Quota, RateLimitService } from './rate-limit.service';

const BY_IP = 'wasafili:rate-limit-ip';

/** Route publique sensible (endpoint de jeton) : limitée par adresse IP. */
export const RateLimitByIp = () => SetMetadata(BY_IP, true);

/**
 * Guard global, après l'authentification et la résolution de l'instance (P7.1.5) : chaque
 * requête compte pour son appelant (utilisateur ou client d'intégration) et pour l'instance
 * visée, qui borne la charge totale qu'une instance impose aux autres. En-têtes `RateLimit-*`
 * (quota le plus contraint) ; au-delà, `429` avec `Retry-After`.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimitService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const quotas: Quota[] = [];
    if (this.reflector.get<boolean>(BY_IP, context.getHandler())) {
      quotas.push({
        key: `ip:${req.ip ?? 'inconnue'}`,
        limit: this.env.LOGIN_RATE_LIMIT_PER_MINUTE,
      });
    }
    const principal = req.principal;
    if (principal?.kind === 'user') {
      quotas.push({ key: `user:${principal.userId}`, limit: this.env.RATE_LIMIT_USER_PER_MINUTE });
    } else if (principal?.kind === 'client') {
      quotas.push({
        key: `client:${principal.clientId}`,
        limit: this.env.RATE_LIMIT_CLIENT_PER_MINUTE,
      });
    }
    if (req.instance) {
      quotas.push({
        key: `instance:${req.instance.id}`,
        limit: this.env.RATE_LIMIT_INSTANCE_PER_MINUTE,
      });
    }

    const state = await this.limiter.consume(quotas);
    if (!state) return true;
    const res = http.getResponse<Response>();
    res.setHeader('RateLimit-Limit', state.limit);
    res.setHeader('RateLimit-Remaining', Math.max(0, state.remaining));
    res.setHeader('RateLimit-Reset', state.reset);
    if (state.remaining >= 0) return true;
    res.setHeader('Retry-After', state.reset);
    throw new HttpException(
      {
        error: 'rate_limited',
        message: `Trop de requêtes : réessayez dans ${state.reset} s`,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
