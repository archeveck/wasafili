import { Body, Controller, ForbiddenException, Get, HttpCode, Post, Req } from '@nestjs/common';
import { type Request } from 'express';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { passwordSchema } from '../auth/password-policy';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { type Actor, CurrentActor } from '../auth/decorators';
import { CurrentPrincipal } from '../auth/decorators';
import { type Principal } from '../auth/principal';
import { PrismaService } from '../prisma/prisma.service';
import { OpenApi } from '../openapi/openapi.decorator';
import * as resources from '../openapi/resources';

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

const instanceSelect = { id: true, short: true, name: true, timeZone: true, locale: true } as const;

@Controller()
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  /**
   * Change le mot de passe de l'utilisateur connecté (12 caractères au moins, pas un mot de
   * passe répandu). Toutes ses sessions sont fermées : il se reconnecte avec le nouveau.
   */
  @Post('me/password')
  @HttpCode(204)
  async changePassword(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>,
    @Req() req: Request,
  ): Promise<void> {
    if (principal.kind !== 'user') {
      throw new ForbiddenException({
        error: 'forbidden',
        message: 'Réservé aux utilisateurs (une clé API n’a pas de mot de passe)',
      });
    }
    await this.auth.changePassword(principal.userId, body.currentPassword, body.newPassword, {
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
  }

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
