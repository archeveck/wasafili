import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client';
import { type RequestContext } from '../common/request-context';

export type TransactionClient = Prisma.TransactionClient;

export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

/** Requête posant les variables RLS pour la transaction en cours uniquement (`is_local`). */
export function setContextQuery(context: RequestContext | undefined): Prisma.Sql {
  return Prisma.sql`SELECT
    set_config('app.instance_id', ${context?.instanceId ?? ''}, true),
    set_config('app.user_id', ${context?.userId ?? ''}, true),
    set_config('app.oauth_client_id', ${context?.oauthClientId ?? ''}, true)`;
}

/**
 * Extension RLS (D6) : chaque opération de modèle s'exécute dans une transaction précédée de
 * `set_config`. Le contexte est relu à chaque appel, donc un même client sert toutes les requêtes.
 */
export function withTenantContext(
  base: PrismaClient,
  getContext: () => RequestContext | undefined,
) {
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const [, result] = await base.$transaction([
            base.$executeRaw(setContextQuery(getContext())),
            query(args),
          ]);
          return result;
        },
      },
    },
  });
}

/** Transaction interactive avec contexte RLS (plusieurs requêtes dépendantes). */
export function tenantTransaction<T>(
  base: PrismaClient,
  context: RequestContext | undefined,
  fn: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
  return base.$transaction(async (tx) => {
    await tx.$executeRaw(setContextQuery(context));
    return fn(tx);
  });
}
