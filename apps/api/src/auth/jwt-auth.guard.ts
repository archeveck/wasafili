import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Request } from 'express';
import { currentContext, runWithContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { IS_PUBLIC } from './decorators';
import { type Principal } from './principal';
import { TokensService } from './tokens.service';

/** Guard global : exige un jeton d'accès Bearer valide, sauf sur les routes `@Public()`. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException({ error: 'unauthorized', message: 'Jeton d accès requis' });
    }

    const claims = await this.tokens.verifyAccessToken(token).catch(() => {
      throw new UnauthorizedException({
        error: 'invalid_token',
        message: 'Jeton d accès invalide ou expiré',
      });
    });

    const principal: Principal =
      claims.typ === 'client' && claims.inst
        ? await this.clientPrincipal(claims.sub, claims.inst)
        : { kind: 'user', userId: claims.sub };
    req.principal = principal;
    if (principal.kind === 'user') {
      const store = currentContext();
      if (store) store.userId = principal.userId;
    }
    return true;
  }

  /**
   * Client d'intégration : relu à chaque requête, pour qu'une révocation ou un changement de
   * permissions s'applique tout de suite plutôt qu'à l'expiration du jeton (P7.1.4).
   */
  private async clientPrincipal(clientId: string, instanceId: string): Promise<Principal> {
    const client = await runWithContext({ instanceId }, () =>
      this.prisma.db.oAuthClient.findUnique({
        where: { id: clientId },
        select: { scopes: true, revokedAt: true },
      }),
    );
    if (!client || client.revokedAt) {
      throw new UnauthorizedException({
        error: 'invalid_token',
        message: 'Clé API révoquée ou supprimée',
      });
    }
    return { kind: 'client', clientId, instanceId, permissions: client.scopes };
  }
}
