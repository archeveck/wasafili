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
import { Can, CurrentInstance } from '../auth/decorators';
import { pageArgs, type Pagination, paginationSchema, toPage } from '../common/pagination';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { type Instance } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PERMISSIONS } from '../tenancy/permissions';
import { IamService } from './iam.service';

const permissions = z.array(z.enum(PERMISSIONS));
const createSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
  name: z.string().trim().min(1).max(100),
  permissions,
});
const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    permissions: permissions.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Aucune modification');

const roleSelect = { id: true, key: true, name: true, permissions: true, isSystem: true } as const;

@Controller(':app/roles')
export class RolesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly iam: IamService,
  ) {}

  @Get()
  @Can('role:read')
  async list(@Query(new ZodValidationPipe(paginationSchema)) pagination: Pagination) {
    const db = this.prisma.db;
    const [roles, total] = await Promise.all([
      db.role.findMany({ ...pageArgs(pagination), orderBy: { key: 'asc' }, select: roleSelect }),
      db.role.count(),
    ]);
    return toPage(roles, total, pagination);
  }

  /** Catalogue des permissions disponibles (éditeur de rôles). */
  @Get('permissions')
  @Can('role:read')
  catalogue() {
    return { data: PERMISSIONS };
  }

  @Post()
  @Can('role:manage')
  create(
    @CurrentInstance() instance: Instance,
    @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>,
  ) {
    return this.iam.createRole(instance.id, body);
  }

  @Patch(':id')
  @Can('role:manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateSchema)) body: z.infer<typeof updateSchema>,
  ) {
    return this.iam.updateRole(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @Can('role:manage')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.iam.deleteRole(id);
  }
}
