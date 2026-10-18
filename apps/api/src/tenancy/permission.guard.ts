import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Request } from 'express';
import { ANY_PERMISSIONS, REQUIRED_PERMISSIONS } from '../auth/decorators';
import { type Permission } from './permissions';

/** Guard global : vérifie les permissions `@Can(...)` dans l'instance résolue par InstanceGuard. */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(
      REQUIRED_PERMISSIONS,
      [context.getHandler(), context.getClass()],
    );
    const any = this.reflector.getAllAndOverride<Permission[] | undefined>(ANY_PERMISSIONS, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length && !any?.length) return true;

    const { permissions } = context.switchToHttp().getRequest<Request>();
    if (!permissions) {
      // @Can() sur une route sans paramètre :app — erreur de développement.
      throw new InternalServerErrorException('@Can() exige une route /:app/...');
    }
    const missing: string[] = (required ?? []).filter((permission) => !permissions.has(permission));
    if (any?.length && !any.some((permission) => permissions.has(permission))) {
      missing.push(any.join(' | '));
    }
    if (missing.length > 0) {
      throw new ForbiddenException({
        error: 'forbidden',
        message: `Permission manquante : ${missing.join(', ')}`,
      });
    }
    return true;
  }
}
