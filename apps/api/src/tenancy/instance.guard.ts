import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { type Request } from 'express';
import { currentContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';

const NOT_FOUND = { error: 'not_found', message: 'Instance introuvable' };

/**
 * Guard global des routes `/:app/...` : résout l'instance par son `short`, vérifie que
 * l'appelant y a accès et pose le contexte RLS. Une instance inaccessible répond 404 comme
 * une instance inexistante, pour ne pas révéler son existence.
 */
@Injectable()
export class InstanceGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const short = req.params['app'];
    if (typeof short !== 'string' || !req.principal) return true;

    const store = currentContext();
    if (!store) throw new InternalServerErrorException('Contexte de requête absent');

    const instance = await this.prisma.db.instance.findUnique({ where: { short } });
    if (!instance) throw new NotFoundException(NOT_FOUND);

    const principal = req.principal;
    if (principal.kind === 'client') {
      if (principal.instanceId !== instance.id) throw new NotFoundException(NOT_FOUND);
      store.instanceId = instance.id;
      req.permissions = new Set(principal.permissions);
    } else {
      store.instanceId = instance.id;
      const membership = await this.prisma.db.membership.findUnique({
        where: { instanceId_userId: { instanceId: instance.id, userId: principal.userId } },
        include: { role: true, user: { select: { isActive: true } } },
      });
      if (!membership) throw new NotFoundException(NOT_FOUND);
      if (!membership.user.isActive) {
        throw new UnauthorizedException({ error: 'unauthorized', message: 'Compte désactivé' });
      }
      req.permissions = new Set(membership.role.permissions);
    }
    req.instance = instance;
    return true;
  }
}
