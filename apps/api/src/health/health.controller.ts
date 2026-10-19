import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { type Response } from 'express';
import { Redis } from 'ioredis';
import { Public } from '../auth/decorators';
import { ENV, type Env } from '../config/env';
import { StorageService } from '../files/storage.service';
import { OpenApi } from '../openapi/openapi.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';

type CheckStatus = 'up' | 'down' | 'disabled';

/** Délai maximal d'une sonde : une dépendance qui ne répond pas est « down ». */
const PROBE_TIMEOUT_MS = 3_000;

/**
 * Sondes d'exploitation, hors préfixe `/v1` (P7.2.2). `/health` : disponibilité (base, Redis,
 * stockage, indispensables ; conversion PDF, facultative) ; `/health/live` : processus vivant.
 */
@Controller('health')
@Public()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly storage: StorageService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Disponibilité : 200 si la base, Redis et le stockage répondent (`status: degraded` si
   * seule la conversion PDF manque), 503 sinon.
   */
  @Get()
  @OpenApi({ produces: ['application/json'] })
  async check(@Res({ passthrough: true }) res: Response) {
    const [database, redis, storage, pdf] = await Promise.all([
      probe(() => this.prisma.ping()),
      probe(() => this.redis.ping()),
      this.env.S3_ENDPOINT ? probe(() => this.storage.ping()) : ('disabled' as const),
      this.env.GOTENBERG_URL ? probe(() => this.gotenberg()) : ('disabled' as const),
    ]);
    const healthy = [database, redis, storage].every((state) => state !== 'down');
    res.status(healthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: healthy ? (pdf === 'down' ? 'degraded' : 'ok') : 'error',
      checks: { database, redis, storage, pdf },
    };
  }

  /** Vivacité : le processus répond (redémarrage du conteneur sinon), sans tester les dépendances. */
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  private async gotenberg(): Promise<void> {
    const response = await fetch(new URL('/health', this.env.GOTENBERG_URL), {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Gotenberg : HTTP ${response.status}`);
  }
}

async function probe(check: () => Promise<unknown>): Promise<CheckStatus> {
  try {
    await Promise.race([
      check(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('délai dépassé')), PROBE_TIMEOUT_MS).unref(),
      ),
    ]);
    return 'up';
  } catch {
    return 'down';
  }
}
