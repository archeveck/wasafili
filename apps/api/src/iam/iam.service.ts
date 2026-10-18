import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hashPassword, randomToken } from '../auth/crypto';
import { type Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { type TransactionClient } from '../prisma/tenant';
import { type Permission } from '../tenancy/permissions';

const notFound = (what: string) =>
  new NotFoundException({ error: 'not_found', message: `${what} introuvable` });

const memberInclude = {
  user: true,
  role: { select: { id: true, key: true, name: true } },
} as const;

type MemberRow = Prisma.MembershipGetPayload<{ include: typeof memberInclude }>;

export function memberDto(member: MemberRow, groups: { id: string; name: string }[] = []) {
  return {
    id: member.user.id,
    email: member.user.email,
    firstName: member.user.firstName,
    lastName: member.user.lastName,
    isActive: member.user.isActive,
    role: member.role,
    attributes: member.attributes,
    groups,
    memberSince: member.createdAt,
  };
}

/** Utilisateurs, rôles et groupes d'une instance (P2.6.1). */
@Injectable()
export class IamService {
  constructor(private readonly prisma: PrismaService) {}

  async getMember(userId: string) {
    const member = await this.prisma.db.membership.findFirst({
      where: { userId },
      include: memberInclude,
    });
    if (!member) throw notFound('Utilisateur');
    const groups = await this.prisma.db.groupMember.findMany({
      where: { userId },
      select: { group: { select: { id: true, name: true } } },
    });
    return memberDto(
      member,
      groups.map(({ group }) => group),
    );
  }

  /**
   * Ajoute un membre. Un compte existant (même e-mail) est rattaché tel quel ; sinon il est
   * créé, avec un mot de passe provisoire renvoyé une seule fois s'il n'est pas fourni.
   * L'invitation par e-mail arrive avec le module d'envoi (P5.2).
   */
  async invite(
    instanceId: string,
    input: {
      email: string;
      firstName: string;
      lastName: string;
      roleId: string;
      password?: string;
      attributes?: Record<string, unknown>;
    },
  ) {
    await this.findRole(input.roleId);
    const email = input.email.trim().toLowerCase();
    let temporaryPassword: string | undefined;
    let user = await this.prisma.db.user.findUnique({ where: { email } });
    if (!user) {
      const password = input.password ?? (temporaryPassword = randomToken().slice(0, 16));
      user = await this.prisma.db.user.create({
        data: {
          email,
          firstName: input.firstName,
          lastName: input.lastName,
          passwordHash: await hashPassword(password),
        },
      });
    }
    const existing = await this.prisma.db.membership.findFirst({ where: { userId: user.id } });
    if (existing) {
      throw new ConflictException({ error: 'conflict', message: 'Déjà membre de cette instance' });
    }
    await this.prisma.db.membership.create({
      data: {
        instanceId,
        userId: user.id,
        roleId: input.roleId,
        attributes: (input.attributes ?? {}) as Prisma.InputJsonValue,
      },
    });
    return {
      ...(await this.getMember(user.id)),
      ...(temporaryPassword ? { temporaryPassword } : {}),
    };
  }

  async updateMember(
    actorId: string | null,
    userId: string,
    input: { roleId?: string; attributes?: Record<string, unknown> },
  ) {
    const member = await this.findMember(userId);
    if (input.roleId && input.roleId !== member.roleId) {
      const role = await this.findRole(input.roleId);
      if (member.role.key === 'admin' && role.key !== 'admin') {
        await this.assertAnotherAdmin(userId);
        if (actorId === userId) {
          throw new ForbiddenException({
            error: 'forbidden',
            message: 'Vous ne pouvez pas retirer votre propre rôle administrateur',
          });
        }
      }
    }
    await this.prisma.db.membership.update({
      where: { id: member.id },
      data: {
        ...(input.roleId ? { roleId: input.roleId } : {}),
        ...(input.attributes ? { attributes: input.attributes as Prisma.InputJsonValue } : {}),
      },
    });
    return this.getMember(userId);
  }

  /** Retire le membre de l'instance (le compte global est conservé). */
  async removeMember(actorId: string | null, userId: string) {
    if (actorId === userId) {
      throw new ForbiddenException({
        error: 'forbidden',
        message: 'Vous ne pouvez pas vous retirer',
      });
    }
    const member = await this.findMember(userId);
    if (member.role.key === 'admin') await this.assertAnotherAdmin(userId);
    await this.prisma.transaction(async (tx) => {
      await tx.groupMember.deleteMany({ where: { userId } });
      // Ses tâches restent planifiées, à réassigner ; ses appareils ne reçoivent plus de push.
      await tx.task.updateMany({
        where: { assigneeUserId: userId },
        data: { assigneeUserId: null },
      });
      await tx.pushToken.deleteMany({ where: { userId } });
      await tx.membership.delete({ where: { id: member.id } });
    });
  }

  // --- Rôles ---------------------------------------------------------------------------

  async createRole(
    instanceId: string,
    input: { key: string; name: string; permissions: Permission[] },
  ) {
    return this.prisma.db.role.create({
      data: {
        instanceId,
        key: input.key,
        name: input.name,
        permissions: [...new Set(input.permissions)],
      },
    });
  }

  async updateRole(id: string, input: { name?: string; permissions?: Permission[] }) {
    const role = await this.findRole(id);
    if (role.key === 'admin' && input.permissions) {
      throw new ForbiddenException({
        error: 'forbidden',
        message: 'Les permissions du rôle administrateur ne sont pas modifiables',
      });
    }
    return this.prisma.db.role.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.permissions ? { permissions: [...new Set(input.permissions)] } : {}),
      },
    });
  }

  async deleteRole(id: string) {
    const role = await this.findRole(id);
    if (role.isSystem) {
      throw new ForbiddenException({ error: 'forbidden', message: 'Rôle système non supprimable' });
    }
    if (await this.prisma.db.membership.count({ where: { roleId: id } })) {
      throw new ConflictException({
        error: 'conflict',
        message: 'Rôle encore attribué à des membres',
      });
    }
    await this.prisma.transaction(async (tx) => {
      await tx.structureAccess.deleteMany({ where: { roleId: id } });
      await tx.role.delete({ where: { id } });
    });
  }

  // --- Groupes -------------------------------------------------------------------------

  async renameGroup(id: string, name: string) {
    await this.findGroup(id);
    return this.prisma.db.group.update({ where: { id }, data: { name } });
  }

  async deleteGroup(id: string) {
    await this.findGroup(id);
    await this.prisma.transaction(async (tx) => {
      await tx.structureAccess.deleteMany({ where: { groupId: id } });
      await tx.task.updateMany({ where: { assigneeGroupId: id }, data: { assigneeGroupId: null } });
      await tx.group.delete({ where: { id } });
    });
  }

  async groupMembers(id: string) {
    await this.findGroup(id);
    const members = await this.prisma.db.groupMember.findMany({
      where: { groupId: id },
      select: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
      orderBy: { user: { email: 'asc' } },
    });
    return members.map(({ user }) => user);
  }

  /** Remplace les membres d'un groupe ; seuls des membres de l'instance sont acceptés. */
  async setGroupMembers(instanceId: string, id: string, userIds: string[]) {
    await this.findGroup(id);
    const unique = [...new Set(userIds)];
    const members = await this.prisma.db.membership.count({ where: { userId: { in: unique } } });
    if (members !== unique.length) {
      throw new BadRequestException({
        error: 'validation_failed',
        message: 'Certains utilisateurs ne sont pas membres de l instance',
      });
    }
    await this.prisma.transaction(async (tx: TransactionClient) => {
      await tx.groupMember.deleteMany({ where: { groupId: id } });
      if (unique.length) {
        await tx.groupMember.createMany({
          data: unique.map((userId) => ({ instanceId, groupId: id, userId })),
        });
      }
    });
    return this.groupMembers(id);
  }

  private async findMember(userId: string) {
    const member = await this.prisma.db.membership.findFirst({
      where: { userId },
      include: { role: true },
    });
    if (!member) throw notFound('Utilisateur');
    return member;
  }

  private async findRole(id: string) {
    const role = await this.prisma.db.role.findUnique({ where: { id } });
    if (!role) throw notFound('Rôle');
    return role;
  }

  private async findGroup(id: string) {
    const group = await this.prisma.db.group.findUnique({ where: { id } });
    if (!group) throw notFound('Groupe');
    return group;
  }

  /** Une instance garde toujours au moins un administrateur. */
  private async assertAnotherAdmin(userId: string) {
    const others = await this.prisma.db.membership.count({
      where: { role: { key: 'admin' }, userId: { not: userId } },
    });
    if (others === 0) {
      throw new ConflictException({
        error: 'last_admin',
        message: 'L instance doit garder au moins un administrateur',
      });
    }
  }
}
