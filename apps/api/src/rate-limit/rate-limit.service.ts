import { Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ENV, type Env } from '../config/env';
import { REDIS } from '../redis/redis.module';

/** Fenêtre fixe d'une minute : compteur Redis incrémenté et expiré atomiquement. */
const CONSUME = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return { count, redis.call('PTTL', KEYS[1]) }
`;
const WINDOW_MS = 60_000;

export interface Quota {
  /** Compteur limité : `user:<id>`, `client:<id>`, `instance:<id>`, `ip:<adresse>`. */
  key: string;
  limit: number;
}

export interface QuotaState {
  limit: number;
  remaining: number;
  /** Secondes avant la remise à zéro de la fenêtre. */
  reset: number;
}

/**
 * Limitation de débit partagée entre les instances de l'API (P7.1.5) : compteurs Redis par
 * minute. Redis indisponible : la requête passe (la disponibilité prime) et l'incident est
 * journalisé ; le healthcheck signale déjà la panne.
 */
@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Consomme une requête sur chaque quota ; renvoie l'état du plus contraint, ou rien. */
  async consume(quotas: readonly Quota[]): Promise<QuotaState | undefined> {
    if (quotas.length === 0) return undefined;
    try {
      const pipeline = this.redis.pipeline();
      for (const quota of quotas) {
        pipeline.eval(CONSUME, 1, `${this.env.RATE_LIMIT_PREFIX}:${quota.key}`, WINDOW_MS);
      }
      const results = (await pipeline.exec()) ?? [];
      const states = quotas.map((quota, i) => {
        const [error, value] = results[i] ?? [new Error('réponse absente'), null];
        if (error) throw error;
        const [count, ttl] = value as [number, number];
        return {
          limit: quota.limit,
          remaining: quota.limit - count,
          reset: Math.max(1, Math.ceil((ttl > 0 ? ttl : WINDOW_MS) / 1000)),
        };
      });
      return states.reduce((tightest, state) =>
        state.remaining < tightest.remaining ? state : tightest,
      );
    } catch (error) {
      this.logger.warn({ err: error }, 'limitation de débit indisponible (Redis)');
      return undefined;
    }
  }
}
