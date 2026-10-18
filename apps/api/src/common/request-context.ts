import { AsyncLocalStorage } from 'node:async_hooks';
import { type NextFunction, type Request, type Response } from 'express';

/**
 * Contexte d'une requête, porté par AsyncLocalStorage. Le middleware ouvre un contexte vide ;
 * les guards le complètent (utilisateur, instance) ; l'extension Prisma le lit pour poser
 * les variables RLS de chaque transaction.
 */
export interface RequestContext {
  userId?: string;
  instanceId?: string;
  oauthClientId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Exécute `fn` dans un contexte donné (scripts, worker, tests). Le résultat est attendu à
 * l'intérieur du contexte : les requêtes Prisma sont paresseuses et ne s'exécutent qu'au
 * premier `await`, qui doit donc avoir lieu avant d'en sortir.
 */
export function runWithContext<T>(
  context: RequestContext,
  fn: () => T | PromiseLike<T>,
): Promise<T> {
  return storage.run(context, async () => await fn());
}

export function requestContextMiddleware(_req: Request, _res: Response, next: NextFunction): void {
  storage.run({}, next);
}
