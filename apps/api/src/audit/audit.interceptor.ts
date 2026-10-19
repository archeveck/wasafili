import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Request } from 'express';
import { concatMap, from, map, type Observable } from 'rxjs';
import { type AuditAction, AuditService, sanitizeMetadata } from './audit.service';

export const AUDIT = 'tesserax:audit';

export interface AuditOptions {
  /** Type de l'objet concerné (défaut : la partie de l'action avant le point). */
  type?: string;
  /** Paramètre de route portant l'identifiant de l'objet (défaut : `id`, sinon `id` de la réponse). */
  param?: string;
  /** Journaliser la chaîne de requête (exports : filtres appliqués) plutôt que le corps. */
  query?: boolean;
}

/** Action journalisée après le succès de la route (P6.3.1). */
export const Audit = (action: AuditAction, options: AuditOptions = {}) =>
  SetMetadata(AUDIT, { action, ...options });

const label = (body: unknown): string | null => {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  const value = record['name'] ?? record['title'] ?? record['email'] ?? record['label'];
  return typeof value === 'string' ? value : null;
};

const idOf = (body: unknown): string | null => {
  const id = body && typeof body === 'object' ? (body as Record<string, unknown>)['id'] : null;
  return typeof id === 'string' ? id : null;
};

/**
 * Écrit l'entrée d'audit des routes marquées `@Audit` une fois la réponse produite : une
 * action refusée ou en échec n'est pas journalisée comme effectuée.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.get<(AuditOptions & { action: AuditAction }) | undefined>(
      AUDIT,
      context.getHandler(),
    );
    if (!options) return next.handle();
    const req = context.switchToHttp().getRequest<Request>();
    return next.handle().pipe(
      concatMap((body: unknown) => {
        const instanceId = req.instance?.id;
        if (!instanceId) return [body];
        const principal = req.principal;
        const param = req.params[options.param ?? 'id'];
        return from(
          this.audit.record({
            instanceId,
            action: options.action,
            actorUserId: principal?.kind === 'user' ? principal.userId : null,
            actorClientId: principal?.kind === 'client' ? principal.clientId : null,
            targetType: options.type ?? options.action.split('.')[0]!,
            targetId: (typeof param === 'string' ? param : null) ?? idOf(body),
            targetLabel: label(body),
            metadata: sanitizeMetadata(options.query ? req.query : req.body),
            ip: req.ip ?? null,
            userAgent: req.get('user-agent') ?? null,
          }),
        ).pipe(map(() => body));
      }),
    );
  }
}
