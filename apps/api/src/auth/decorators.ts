import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import { type Request } from 'express';
import { type Permission } from '../tenancy/permissions';

export const IS_PUBLIC = 'tesserax:public';
export const REQUIRED_PERMISSIONS = 'tesserax:permissions';
export const ANY_PERMISSIONS = 'tesserax:any-permissions';

/** Route accessible sans jeton. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Permissions exigées (toutes) dans l'instance de la route `/:app/...`. */
export const Can = (...permissions: Permission[]) => SetMetadata(REQUIRED_PERMISSIONS, permissions);

/** Au moins une des permissions (ex. lire toutes les fiches ou seulement les siennes). */
export const CanAny = (...permissions: Permission[]) => SetMetadata(ANY_PERMISSIONS, permissions);

/** Appelant dans l'instance courante : identité, rôles et permissions. */
export interface Actor {
  /** Utilisateur ; null pour un client d'intégration. */
  userId: string | null;
  roles: readonly string[];
  permissions: ReadonlySet<string>;
}

export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): Actor => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return {
    userId: req.principal?.kind === 'user' ? req.principal.userId : null,
    roles: req.roles ?? [],
    permissions: req.permissions ?? new Set(),
  };
});

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<Request>().principal,
);

export const CurrentInstance = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<Request>().instance,
);
