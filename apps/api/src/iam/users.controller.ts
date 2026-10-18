import { Controller, Get, Query } from '@nestjs/common';
import { Can } from '../auth/decorators';
import { pageArgs, type Pagination, paginationSchema, toPage } from '../common/pagination';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

@Controller(':app/users')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  /** Membres de l'instance (la RLS limite les adhésions à l'instance courante). */
  @Get()
  @Can('user:read')
  async list(@Query(new ZodValidationPipe(paginationSchema)) pagination: Pagination) {
    const db = this.prisma.db;
    const [memberships, total] = await Promise.all([
      db.membership.findMany({
        ...pageArgs(pagination),
        orderBy: { user: { email: 'asc' } },
        include: { user: true, role: { select: { key: true, name: true } } },
      }),
      db.membership.count(),
    ]);
    return toPage(
      memberships.map(({ user, role, createdAt }) => ({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        isActive: user.isActive,
        role,
        memberSince: createdAt,
      })),
      total,
      pagination,
    );
  }
}
