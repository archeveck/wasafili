import { BadRequestException, Injectable } from '@nestjs/common';
import { type StructureDefinition } from '@wasafili/form-schema';
import { type Actor } from '../auth/decorators';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FILTER_OPERATORS, type Filter, filterableFields, filterSql } from '../submissions/query';

export const STRUCTURE_PERMISSIONS = [
  'create',
  'read:all',
  'read:own',
  'update',
  'delete',
  'export',
] as const;
export type StructurePermission = (typeof STRUCTURE_PERMISSIONS)[number];

/** Permission d'instance équivalente, utilisée tant qu'une structure n'a aucune règle. */
const INSTANCE_EQUIVALENT: Record<StructurePermission, string> = {
  create: 'submission:create',
  'read:all': 'submission:read:all',
  'read:own': 'submission:read:own',
  update: 'submission:update',
  delete: 'submission:delete',
  export: 'submission:export',
};

export interface StructureRights {
  permissions: ReadonlySet<StructurePermission>;
  /** Groupes de filtres combinés en OU (chaque groupe en ET) ; null = aucune restriction. */
  visibility: Filter[][] | null;
}

export interface AccessRuleInput {
  roleId?: string;
  groupId?: string;
  permissions: StructurePermission[];
  visibility?: Filter[];
}

const invalid = (message: string) =>
  new BadRequestException({ error: 'validation_failed', message });

@Injectable()
export class StructureAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Droits effectifs de l'appelant sur une structure. Un administrateur d'instance a tous les
   * droits ; sans règle sur la structure, les permissions d'instance s'appliquent ; sinon,
   * union des règles de son rôle et de ses groupes.
   */
  async effective(structureId: string, actor: Actor): Promise<StructureRights> {
    const fromInstance = (): StructureRights => ({
      permissions: new Set(
        STRUCTURE_PERMISSIONS.filter((p) => actor.permissions.has(INSTANCE_EQUIVALENT[p])),
      ),
      visibility: null,
    });
    if (actor.permissions.has('instance:manage')) {
      return { permissions: new Set(STRUCTURE_PERMISSIONS), visibility: null };
    }
    const rules = await this.prisma.db.structureAccess.findMany({ where: { structureId } });
    if (rules.length === 0 || !actor.userId) return fromInstance();

    const groups = new Set(
      (
        await this.prisma.db.groupMember.findMany({
          where: { userId: actor.userId },
          select: { groupId: true },
        })
      ).map((member) => member.groupId),
    );
    const matching = rules.filter(
      (rule) => rule.roleId === actor.roleId || (rule.groupId !== null && groups.has(rule.groupId)),
    );
    const visibility = matching.map((rule) => (rule.visibility as Filter[] | null) ?? []);
    return {
      permissions: new Set(matching.flatMap((rule) => rule.permissions as StructurePermission[])),
      visibility:
        matching.length === 0 || visibility.some((filters) => filters.length === 0)
          ? null
          : visibility,
    };
  }

  /** Condition SQL de visibilité (alias `s`) ; `TRUE` sans restriction. */
  visibilitySql(
    rights: StructureRights,
    actor: Actor,
    definition: StructureDefinition | undefined,
  ) {
    if (!rights.visibility) return Prisma.sql`TRUE`;
    const fields = filterableFields(definition);
    const groups = rights.visibility.map((filters) => {
      const parts = filters.map((filter) => {
        const value = this.resolve(filter.value, actor);
        // Attribut absent : la règle ne donne accès à aucune fiche.
        return value === undefined ? Prisma.sql`FALSE` : filterSql({ ...filter, value }, fields);
      });
      return Prisma.sql`(${Prisma.join(parts, ' AND ')})`;
    });
    return Prisma.sql`(${Prisma.join(groups, ' OR ')})`;
  }

  async rules(structureId: string) {
    return this.prisma.db.structureAccess.findMany({
      where: { structureId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, roleId: true, groupId: true, permissions: true, visibility: true },
    });
  }

  /** Remplace toutes les règles d'une structure. */
  async replaceRules(
    instanceId: string,
    structureId: string,
    definition: StructureDefinition | undefined,
    rules: AccessRuleInput[],
  ) {
    const fields = filterableFields(definition);
    const targets = new Set<string>();
    for (const rule of rules) {
      const target = rule.roleId ? `role:${rule.roleId}` : `group:${rule.groupId}`;
      if (targets.has(target)) throw invalid('Une seule règle par rôle ou groupe');
      targets.add(target);
      for (const filter of rule.visibility ?? []) {
        if (!fields.has(filter.key)) throw invalid(`Champ non filtrable : ${filter.key}`);
        if (!(FILTER_OPERATORS as readonly string[]).includes(filter.operator)) {
          throw invalid(`Opérateur inconnu : ${filter.operator}`);
        }
      }
    }
    await this.prisma.transaction(async (tx) => {
      await tx.structureAccess.deleteMany({ where: { structureId } });
      for (const rule of rules) {
        await tx.structureAccess.create({
          data: {
            instanceId,
            structureId,
            roleId: rule.roleId ?? null,
            groupId: rule.groupId ?? null,
            permissions: [...new Set(rule.permissions)],
            visibility: rule.visibility?.length
              ? (rule.visibility as unknown as Prisma.InputJsonValue)
              : Prisma.DbNull,
          },
        });
      }
    });
    return this.rules(structureId);
  }

  private resolve(value: string, actor: Actor): string | undefined {
    if (!value.startsWith('$user.')) return value;
    const name = value.slice('$user.'.length);
    const resolved = name === 'id' ? actor.userId : actor.attributes[name];
    if (resolved === null || resolved === undefined) return undefined;
    return typeof resolved === 'string' ||
      typeof resolved === 'number' ||
      typeof resolved === 'boolean'
      ? String(resolved)
      : undefined;
  }
}
