import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { passwordSchema } from '../auth/password-policy';
import { type Actor, Can, CurrentActor, CurrentInstance } from '../auth/decorators';
import { pageArgs, type Pagination, paginationSchema, toPage } from '../common/pagination';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { type Instance } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IamService, memberDto } from './iam.service';
import { Audit } from '../audit/audit.interceptor';
import { OpenApi } from '../openapi/openapi.decorator';
import * as resources from '../openapi/resources';

const attributes = z.record(
  z.string().regex(/^[a-z][a-z0-9_]*$/),
  z.union([z.string(), z.number(), z.boolean()]),
);
const inviteSchema = z.object({
  email: z.email(),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  roleId: z.uuid(),
  password: passwordSchema.optional(),
  attributes: attributes.optional(),
});
const updateSchema = z
  .object({ roleId: z.uuid().optional(), attributes: attributes.optional() })
  .refine((body) => Object.keys(body).length > 0, 'Aucune modification');

@Controller(':app/users')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly iam: IamService,
  ) {}

  /** Membres de l'instance (la RLS limite les adhésions à l'instance courante). */
  @Get()
  @Can('user:read')
  @OpenApi({ page: resources.member })
  async list(@Query(new ZodValidationPipe(paginationSchema)) pagination: Pagination) {
    const db = this.prisma.db;
    const [memberships, total] = await Promise.all([
      db.membership.findMany({
        ...pageArgs(pagination),
        orderBy: { user: { email: 'asc' } },
        include: { user: true, role: { select: { id: true, key: true, name: true } } },
      }),
      db.membership.count(),
    ]);
    const groups = await db.groupMember.findMany({
      where: { userId: { in: memberships.map((m) => m.userId) } },
      select: { userId: true, group: { select: { id: true, name: true } } },
    });
    return toPage(
      memberships.map((member) =>
        memberDto(
          member,
          groups.filter((g) => g.userId === member.userId).map((g) => g.group),
        ),
      ),
      total,
      pagination,
    );
  }

  /** Détail d'un membre. */
  @Get(':userId')
  @Can('user:read')
  @OpenApi({ response: resources.member })
  get(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.iam.getMember(userId);
  }

  /** Ajoute un membre ; un compte est créé avec un mot de passe temporaire s'il n'existe pas. */
  @Post()
  @Audit('user.create')
  @Can('user:manage')
  @OpenApi({ response: resources.member })
  invite(
    @CurrentInstance() instance: Instance,
    @Body(new ZodValidationPipe(inviteSchema)) body: z.infer<typeof inviteSchema>,
  ) {
    return this.iam.invite(instance.id, body);
  }

  /** Modifie un membre (rôle, attributs, activation). */
  @Patch(':userId')
  @Audit('user.update', { param: 'userId' })
  @Can('user:manage')
  @OpenApi({ response: resources.member })
  update(
    @CurrentActor() actor: Actor,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodValidationPipe(updateSchema)) body: z.infer<typeof updateSchema>,
  ) {
    return this.iam.updateMember(actor.userId, userId, body);
  }

  /** Retire un membre de l'instance. */
  @Delete(':userId')
  @Audit('user.remove', { param: 'userId' })
  @HttpCode(204)
  @Can('user:manage')
  remove(@CurrentActor() actor: Actor, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.iam.removeMember(actor.userId, userId);
  }

  /**
   * Réinitialise le mot de passe d'un membre : un mot de passe provisoire est renvoyé une seule
   * fois et ses sessions sont fermées. Refusé (409) pour un compte partagé avec d'autres
   * instances.
   */
  @Post(':userId/password-reset')
  @Audit('user.password_reset', { param: 'userId' })
  @HttpCode(200)
  @Can('user:manage')
  @OpenApi({ response: resources.temporaryPassword })
  resetPassword(@CurrentActor() actor: Actor, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.iam.resetPassword(actor.userId, userId);
  }
}
