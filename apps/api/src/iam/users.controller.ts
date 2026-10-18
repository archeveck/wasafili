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
import { type Actor, Can, CurrentActor, CurrentInstance } from '../auth/decorators';
import { pageArgs, type Pagination, paginationSchema, toPage } from '../common/pagination';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { type Instance } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IamService, memberDto } from './iam.service';

const attributes = z.record(
  z.string().regex(/^[a-z][a-z0-9_]*$/),
  z.union([z.string(), z.number(), z.boolean()]),
);
const inviteSchema = z.object({
  email: z.email(),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  roleId: z.uuid(),
  password: z.string().min(10).max(200).optional(),
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

  @Get(':userId')
  @Can('user:read')
  get(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.iam.getMember(userId);
  }

  @Post()
  @Can('user:manage')
  invite(
    @CurrentInstance() instance: Instance,
    @Body(new ZodValidationPipe(inviteSchema)) body: z.infer<typeof inviteSchema>,
  ) {
    return this.iam.invite(instance.id, body);
  }

  @Patch(':userId')
  @Can('user:manage')
  update(
    @CurrentActor() actor: Actor,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodValidationPipe(updateSchema)) body: z.infer<typeof updateSchema>,
  ) {
    return this.iam.updateMember(actor.userId, userId, body);
  }

  @Delete(':userId')
  @HttpCode(204)
  @Can('user:manage')
  remove(@CurrentActor() actor: Actor, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.iam.removeMember(actor.userId, userId);
  }
}
