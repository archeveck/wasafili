import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { pageArgs, type Pagination, toPage } from '../common/pagination';
import { type Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  type ExistingItem,
  exportTable,
  type ImportMode,
  type LevelMapping,
  planImport,
} from './list-transfer';
import { readSpreadsheet, type SpreadsheetFormat, writeSpreadsheet } from './spreadsheet';

const MAX_IMPORT_ROWS = 20_000;

const itemSelect = {
  id: true,
  listId: true,
  parentId: true,
  level: true,
  code: true,
  label: true,
  attributes: true,
  position: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export interface ItemQuery extends Pagination {
  parent_id?: string;
  level?: number;
  q?: string;
  code?: string;
  include_archived: boolean;
}

const notFound = (what: string) =>
  new NotFoundException({ error: 'not_found', message: `${what} introuvable` });

@Injectable()
export class ListsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(pagination: Pagination) {
    const db = this.prisma.db;
    const [lists, total] = await Promise.all([
      db.list.findMany({
        ...pageArgs(pagination),
        orderBy: { name: 'asc' },
        include: { _count: { select: { items: { where: { archivedAt: null } } } } },
      }),
      db.list.count(),
    ]);
    return toPage(
      lists.map(({ _count, ...list }) => ({ ...list, itemCount: _count.items })),
      total,
      pagination,
    );
  }

  async get(id: string) {
    const list = await this.prisma.db.list.findUnique({ where: { id } });
    if (!list) throw notFound('Référentiel');
    return list;
  }

  create(instanceId: string, input: { name: string; description?: string; levels: string[] }) {
    return this.prisma.db.list.create({
      data: {
        instanceId,
        name: input.name,
        description: input.description ?? null,
        levels: input.levels,
      },
    });
  }

  async update(
    id: string,
    input: { name?: string; description?: string | null; levels?: string[] },
  ) {
    const list = await this.get(id);
    if (input.levels && input.levels.length < list.levels.length) {
      const deepest = await this.prisma.db.listItem.findFirst({
        where: { listId: id, level: { gte: input.levels.length } },
        select: { id: true },
      });
      if (deepest) {
        throw new BadRequestException({
          error: 'validation_failed',
          message: 'Des éléments existent aux niveaux supprimés',
        });
      }
    }
    return this.prisma.db.list.update({ where: { id }, data: input });
  }

  async remove(id: string) {
    await this.get(id);
    // Les fiches référencent les éléments par identifiant : la suppression est définitive.
    await this.prisma.transaction(async (tx) => {
      await tx.$executeRaw`DELETE FROM list_items WHERE list_id = ${id}::uuid`;
      await tx.list.delete({ where: { id } });
    });
  }

  /** Éléments filtrés (cascade par parent, niveau, recherche, code), pagination. */
  async items(listId: string, query: ItemQuery) {
    await this.get(listId);
    const where: Prisma.ListItemWhereInput = {
      listId,
      ...(query.include_archived ? {} : { archivedAt: null }),
      ...(query.parent_id === 'root'
        ? { parentId: null }
        : query.parent_id
          ? { parentId: query.parent_id }
          : {}),
      ...(query.level !== undefined ? { level: query.level } : {}),
      ...(query.code ? { code: query.code } : {}),
      ...(query.q
        ? {
            OR: [
              { label: { contains: query.q, mode: 'insensitive' as const } },
              { code: { contains: query.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const db = this.prisma.db;
    const [items, total] = await Promise.all([
      db.listItem.findMany({
        where,
        ...pageArgs(query),
        orderBy: [{ level: 'asc' }, { position: 'asc' }, { label: 'asc' }],
        select: itemSelect,
      }),
      db.listItem.count({ where }),
    ]);
    return toPage(items, total, query);
  }

  /** Recherche par code (scan QR, P1.5.5) ou par identifiants, dans tous les référentiels. */
  lookup(query: { code?: string | undefined; ids?: string[] | undefined }) {
    return this.prisma.db.listItem.findMany({
      where: query.ids ? { id: { in: query.ids } } : { code: query.code!, archivedAt: null },
      select: { ...itemSelect, list: { select: { id: true, name: true, levels: true } } },
      take: query.ids ? 200 : 20,
    });
  }

  async createItem(
    instanceId: string,
    listId: string,
    input: {
      label: string;
      code?: string;
      parentId?: string;
      attributes?: Record<string, unknown>;
      position?: number;
    },
  ) {
    const list = await this.get(listId);
    let level = 0;
    if (input.parentId) {
      const parent = await this.prisma.db.listItem.findFirst({
        where: { id: input.parentId, listId },
      });
      if (!parent) throw notFound('Élément parent');
      level = parent.level + 1;
    }
    if (level >= list.levels.length) {
      throw new BadRequestException({
        error: 'validation_failed',
        message: `Le référentiel n'a que ${list.levels.length} niveau(x)`,
      });
    }
    return this.prisma.db.listItem.create({
      data: {
        instanceId,
        listId,
        parentId: input.parentId ?? null,
        level,
        code: input.code ?? null,
        label: input.label,
        attributes: (input.attributes ?? {}) as Prisma.InputJsonValue,
        position: input.position ?? 0,
      },
      select: itemSelect,
    });
  }

  async updateItem(
    listId: string,
    itemId: string,
    input: {
      label?: string;
      code?: string | null;
      attributes?: Record<string, unknown>;
      position?: number;
      archived?: false;
    },
  ) {
    await this.findItem(listId, itemId);
    const { archived, attributes, ...rest } = input;
    return this.prisma.db.listItem.update({
      where: { id: itemId },
      data: {
        ...rest,
        ...(attributes ? { attributes: attributes as Prisma.InputJsonValue } : {}),
        ...(archived === false ? { archivedAt: null } : {}),
      },
      select: itemSelect,
    });
  }

  /** Archive l'élément et toute sa descendance. */
  async archiveItem(listId: string, itemId: string) {
    await this.findItem(listId, itemId);
    await this.prisma.transaction(
      (tx) => tx.$executeRaw`
        WITH RECURSIVE subtree AS (
          SELECT id FROM list_items WHERE id = ${itemId}::uuid
          UNION ALL
          SELECT c.id FROM list_items c JOIN subtree s ON c.parent_id = s.id
        )
        UPDATE list_items SET archived_at = now(), updated_at = now()
        WHERE id IN (SELECT id FROM subtree) AND archived_at IS NULL`,
    );
  }

  async import(
    listId: string,
    file: Buffer,
    options: { mode: ImportMode; dryRun: boolean; mapping?: LevelMapping[] },
  ) {
    const list = await this.get(listId);
    const table = await readSpreadsheet(file).catch(() => {
      throw new BadRequestException({
        error: 'invalid_file',
        message: 'Fichier CSV ou XLSX illisible',
      });
    });
    if (table.rows.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException({
        error: 'invalid_file',
        message: `Import limité à ${MAX_IMPORT_ROWS} lignes`,
      });
    }

    const plan = planImport({
      levels: list.levels,
      ...table,
      existing: await this.existingItems(listId),
      mode: options.mode,
      ...(options.mapping ? { mapping: options.mapping } : {}),
      newId: randomUUID,
    });
    const report = {
      dryRun: options.dryRun,
      applied: false,
      rows: table.rows.length,
      created: plan.creates.length,
      updated: plan.updates.length,
      unchanged: plan.unchanged,
      archived: plan.archives.length,
      errors: plan.errors,
      preview: plan.creates.slice(0, 20).map(({ level, code, label }) => ({ level, code, label })),
    };
    if (options.dryRun || plan.errors.length > 0) return report;

    await this.prisma.transaction(async (tx) => {
      // Création par niveau croissant : un parent existe toujours avant ses enfants.
      const creates = [...plan.creates].sort((a, b) => a.level - b.level);
      if (creates.length) {
        await tx.listItem.createMany({
          data: creates.map((item) => ({
            ...item,
            instanceId: list.instanceId,
            listId,
            attributes: item.attributes as Prisma.InputJsonValue,
          })),
        });
      }
      for (const { id, unarchive, attributes, ...changes } of plan.updates) {
        await tx.listItem.update({
          where: { id },
          data: {
            ...changes,
            ...(attributes ? { attributes: attributes as Prisma.InputJsonValue } : {}),
            ...(unarchive ? { archivedAt: null } : {}),
          },
        });
      }
      if (plan.archives.length) {
        await tx.listItem.updateMany({
          where: { id: { in: plan.archives } },
          data: { archivedAt: new Date() },
        });
      }
    });
    return { ...report, applied: true };
  }

  async export(listId: string, format: SpreadsheetFormat) {
    const list = await this.get(listId);
    const table = exportTable(list.levels, await this.existingItems(listId));
    return { name: list.name, content: await writeSpreadsheet(format, table) };
  }

  private async existingItems(listId: string): Promise<ExistingItem[]> {
    const items = await this.prisma.db.listItem.findMany({ where: { listId } });
    return items.map((item) => ({
      id: item.id,
      parentId: item.parentId,
      level: item.level,
      code: item.code,
      label: item.label,
      attributes: (item.attributes ?? {}) as Record<string, unknown>,
      archived: item.archivedAt !== null,
      position: item.position,
    }));
  }

  private async findItem(listId: string, itemId: string) {
    const item = await this.prisma.db.listItem.findFirst({ where: { id: itemId, listId } });
    if (!item) throw notFound('Élément');
    return item;
  }
}
