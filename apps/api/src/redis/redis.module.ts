import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { ENV, type Env } from '../config/env';

export const REDIS = Symbol('REDIS');

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ENV],
      // Pas de file d'attente hors ligne : une indisponibilité Redis remonte immédiatement
      // (healthcheck) au lieu de bloquer les requêtes.
      useFactory: (env: Env) =>
        new Redis(env.REDIS_URL, { enableOfflineQueue: false, maxRetriesPerRequest: 1 }),
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationBootstrap, OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /**
   * Attend la connexion (5 s au plus) avant d'accepter des requêtes : sans file hors ligne,
   * les premières commandes échoueraient (limitation de débit inopérante au démarrage).
   */
  async onApplicationBootstrap(): Promise<void> {
    if (this.redis.status === 'ready') return;
    const ready = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 5_000);
      this.redis.once('ready', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    if (!ready) new Logger(RedisModule.name).warn('Redis injoignable au démarrage');
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }
}
