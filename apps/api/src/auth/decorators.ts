import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import { type Request } from 'express';
import { type Permission } from '../tenancy/permissions';

export const IS_PUBLIC = 'tesserax:public';
export const REQUIRED_PERMISSIONS = 'tesserax:permissions';

/** Route accessible sans jeton. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Permissions exigées (toutes) dans l'instance de la route `/:app/...`. */
export const Can = (...permissions: Permission[]) => SetMetadata(REQUIRED_PERMISSIONS, permissions);

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<Request>().principal,
);

export const CurrentInstance = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<Request>().instance,
);
