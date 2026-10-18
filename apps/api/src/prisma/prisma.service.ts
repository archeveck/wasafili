import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { currentContext } from '../common/request-context';
import { ENV, type Env } from '../config/env';
import {
  createPrismaClient,
  tenantTransaction,
  type TransactionClient,
  withTenantContext,
} from './tenant';

/**
 * Accès base de données. Toujours connecté avec le rôle applicatif (sans BYPASSRLS) :
 * - `db` : client étendu, chaque opération porte le contexte RLS de la requête courante ;
 * - `transaction()` : transaction interactive portant ce même contexte.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  private readonly base;
  readonly db;

  constructor(@Inject(ENV) env: Env) {
    this.base = createPrismaClient(env.DATABASE_URL);
    this.db = withTenantContext(this.base, currentContext);
  }

  transaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
    return tenantTransaction(this.base, currentContext(), fn);
  }

  async ping(): Promise<void> {
    await this.base.$queryRaw`SELECT 1`;
  }

  async onModuleDestroy(): Promise<void> {
    await this.base.$disconnect();
  }
}
