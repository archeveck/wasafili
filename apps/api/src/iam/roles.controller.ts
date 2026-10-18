import { Controller, Get, Query } from '@nestjs/common';
import { Can } from '../auth/decorators';
import { pageArgs, type Pagination, paginationSchema, toPage } from '../common/pagination';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

@Controller(':app/roles')
export class RolesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Can('role:read')
  async list(@Query(new ZodValidationPipe(paginationSchema)) pagination: Pagination) {
    const db = this.prisma.db;
    const [roles, total] = await Promise.all([
      db.role.findMany({
        ...pageArgs(pagination),
        orderBy: { key: 'asc' },
        select: { id: true, key: true, name: true, permissions: true, isSystem: true },
      }),
      db.role.count(),
    ]);
    return toPage(roles, total, pagination);
  }
}
