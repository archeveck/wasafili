import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { Can, CurrentInstance } from '../auth/decorators';
import { pageArgs, type Pagination, paginationSchema, toPage } from '../common/pagination';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { type Instance } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const createGroupSchema = z.object({ name: z.string().trim().min(1).max(100) });

const groupSelect = {
  id: true,
  name: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { members: true } },
} as const;

@Controller(':app/groups')
export class GroupsController {
  constructor(private readonly prisma: PrismaService) {}

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

  @Get(':id')
  @Can('group:read')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const group = await this.prisma.db.group.findUnique({ where: { id }, select: groupSelect });
    if (!group) throw new NotFoundException({ error: 'not_found', message: 'Groupe introuvable' });
    return group;
  }

  @Post()
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
