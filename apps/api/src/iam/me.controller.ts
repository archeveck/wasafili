import { Controller, Get } from '@nestjs/common';
import { type Actor, CurrentActor } from '../auth/decorators';
import { CurrentPrincipal } from '../auth/decorators';
import { type Principal } from '../auth/principal';
import { PrismaService } from '../prisma/prisma.service';
import { OpenApi } from '../openapi/openapi.decorator';
import * as resources from '../openapi/resources';

const instanceSelect = { id: true, short: true, name: true, timeZone: true, locale: true } as const;

@Controller()
export class MeController {
  constructor(private readonly prisma: PrismaService) {}

  /** Profil de l'appelant. */
  @Get('me')
  @OpenApi({ response: resources.me })
  async me(@CurrentPrincipal() principal: Principal) {
    if (principal.kind === 'client') {
      return { kind: 'client', id: principal.clientId, permissions: principal.permissions };
    }
    const user = await this.prisma.db.user.findUniqueOrThrow({
      where: { id: principal.userId },
      select: { id: true, email: true, firstName: true, lastName: true, lastLoginAt: true },
    });
    return { kind: 'user', ...user };
  }

  /** Rôle et permissions de l'appelant dans l'instance (affichage des actions possibles). */
  @Get(':app/me')
  @OpenApi({ response: resources.memberProfile })
  async member(@CurrentPrincipal() principal: Principal, @CurrentActor() actor: Actor) {
    const profile = await this.me(principal);
    return { ...profile, roles: actor.roles, permissions: [...actor.permissions].sort() };
  }

  /** Instances (« apps ») accessibles à l'appelant : sert à la sélection d'instance. */
  @Get('apps')
  @OpenApi({ list: resources.app })
  async apps(@CurrentPrincipal() principal: Principal) {
    const db = this.prisma.db;
    if (principal.kind === 'client') {
      const instance = await db.instance.findUniqueOrThrow({
        where: { id: principal.instanceId },
        select: instanceSelect,
      });
      return { data: [instance] };
    }
    // Hors contexte d'instance, la RLS n'expose que les adhésions de l'utilisateur courant.
    const memberships = await db.membership.findMany({
      include: { instance: { select: instanceSelect } },
      orderBy: { instance: { name: 'asc' } },
    });
    return { data: memberships.map(({ instance }) => instance) };
  }
}
