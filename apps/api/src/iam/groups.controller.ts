import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { Can, CurrentInstance } from '../auth/decorators';
import { pageArgs, type Pagination, paginationSchema, toPage } from '../common/pagination';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { type Instance } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IamService } from './iam.service';
import { Audit } from '../audit/audit.interceptor';

const createGroupSchema = z.object({ name: z.string().trim().min(1).max(100) });
const membersSchema = z.object({ userIds: z.array(z.uuid()).max(1000) });

const groupSelect = {
  id: true,
  name: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { members: true } },
} as const;

@Controller(':app/groups')
export class GroupsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly iam: IamService,
  ) {}

  /** Groupes de l'instance. */
  @Get()
  @Can('group:read')
  async list(@Query(new ZodValidationPipe(paginationSchema)) pagination: Pagination) {
    const db = this.prisma.db;
    const [groups, total] = await Promise.all([
      db.group.findMany({ ...pageArgs(pagination), orderBy: { name: 'asc' }, select: groupSelect }),
      db.group.count(),
    ]);
    return toPage(groups, total, pagination);
  }

  /** Détail d'un groupe et de ses membres. */
  @Get(':id')
  @Can('group:read')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const group = await this.prisma.db.group.findUnique({ where: { id }, select: groupSelect });
    if (!group) throw new NotFoundException({ error: 'not_found', message: 'Groupe introuvable' });
    return { ...group, members: await this.iam.groupMembers(id) };
  }

  /** Renomme un groupe. */
  @Patch(':id')
  @Audit('group.update')
  @Can('group:manage')
  rename(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(createGroupSchema)) body: z.infer<typeof createGroupSchema>,
  ) {
    return this.iam.renameGroup(id, body.name);
  }

  /** Supprime un groupe. */
  @Delete(':id')
  @Audit('group.delete')
  @HttpCode(204)
  @Can('group:manage')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.iam.deleteGroup(id);
  }

  /** Remplace la liste des membres d'un groupe. */
  @Put(':id/members')
  @Audit('group.members', { type: 'group' })
  @Can('group:manage')
  async setMembers(
    @CurrentInstance() instance: Instance,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(membersSchema)) body: z.infer<typeof membersSchema>,
  ) {
    return { data: await this.iam.setGroupMembers(instance.id, id, body.userIds) };
  }

  /** Crée un groupe. */
  @Post()
  @Audit('group.create')
  @Can('group:manage')
  create(
    @CurrentInstance() instance: Instance,
    @Body(new ZodValidationPipe(createGroupSchema)) body: z.infer<typeof createGroupSchema>,
  ) {
    return this.prisma.db.group.create({
      data: { instanceId: instance.id, name: body.name },
      select: groupSelect,
    });
  }
}
