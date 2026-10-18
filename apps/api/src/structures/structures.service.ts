import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { analyzeDefinition } from '@tesserax/form-engine';
import { emptyDefinition, type StructureDefinition } from '@tesserax/form-schema';
import { pageArgs, type Pagination, toPage } from '../common/pagination';
import { type Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type VersionRef = 'draft' | 'current' | number;

const versionSummary = {
  id: true,
  version: true,
  status: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const NOT_FOUND = { error: 'not_found', message: 'Structure introuvable' };

/** Valide une définition (schéma + analyse sémantique) ; 422 avec le détail sinon. */
export function assertValidDefinition(input: unknown): StructureDefinition {
  const analysis = analyzeDefinition(input);
  if (!analysis.ok) {
    throw new UnprocessableEntityException({
      error: 'invalid_definition',
      message: 'Définition de structure invalide',
      details: analysis.issues,
    });
  }
  return analysis.definition;
}

@Injectable()
export class StructuresService {
  constructor(private readonly prisma: PrismaService) {}

  async list(pagination: Pagination, includeArchived: boolean) {
    const where: Prisma.StructureWhereInput = includeArchived ? {} : { archivedAt: null };
    const db = this.prisma.db;
    const [structures, total] = await Promise.all([
      db.structure.findMany({
        where,
        ...pageArgs(pagination),
        orderBy: { name: 'asc' },
        include: { versions: { select: versionSummary, where: { status: { not: 'ARCHIVED' } } } },
      }),
      db.structure.count({ where }),
    ]);
    return toPage(
      structures.map((structure) => this.toDto(structure)),
      total,
      pagination,
    );
  }

  async get(id: string) {
    const structure = await this.prisma.db.structure.findUnique({
      where: { id },
      include: { versions: { select: versionSummary, orderBy: { version: 'desc' } } },
    });
    if (!structure) throw new NotFoundException(NOT_FOUND);
    return { ...this.toDto(structure), versions: structure.versions };
  }

  /** Crée la structure et son premier brouillon (v1). */
  async create(
    instanceId: string,
    input: { name: string; description?: string; definition?: unknown },
  ) {
    const definition =
      input.definition === undefined ? emptyDefinition() : assertValidDefinition(input.definition);
    const id = await this.prisma.transaction(async (tx) => {
      const structure = await tx.structure.create({
        data: { instanceId, name: input.name, description: input.description ?? null },
      });
      await tx.structureVersion.create({
        data: {
          instanceId,
          structureId: structure.id,
          version: 1,
          definition: definition as Prisma.InputJsonValue,
        },
      });
      return structure.id;
    });
    return this.get(id);
  }

  async update(id: string, input: { name?: string; description?: string | null }) {
    await this.ensureExists(id);
    await this.prisma.db.structure.update({ where: { id }, data: input });
    return this.get(id);
  }

  /** Archivage (les fiches existantes restent consultables). */
  async archive(id: string) {
    await this.ensureExists(id);
    await this.prisma.db.structure.update({ where: { id }, data: { archivedAt: new Date() } });
  }

  async getVersion(id: string, ref: VersionRef) {
    await this.ensureExists(id);
    const where: Prisma.StructureVersionWhereInput =
      ref === 'draft'
        ? { structureId: id, status: 'DRAFT' }
        : ref === 'current'
          ? { structureId: id, status: 'PUBLISHED' }
          : { structureId: id, version: ref };
    const version = await this.prisma.db.structureVersion.findFirst({ where });
    if (!version) {
      throw new NotFoundException({ error: 'not_found', message: 'Version introuvable' });
    }
    return version;
  }

  /** Version courante (publiée) d'une structure active, utilisée pour toute nouvelle fiche. */
  currentVersion(structureId: string) {
    return this.prisma.db.structureVersion.findFirst({
      where: { structureId, status: 'PUBLISHED', structure: { archivedAt: null } },
    });
  }

  /** Enregistre le brouillon (le crée à partir de la version suivante s'il n'existe pas). */
  async saveDraft(instanceId: string, id: string, input: unknown) {
    await this.ensureExists(id);
    const definition = assertValidDefinition(input) as Prisma.InputJsonValue;
    return this.prisma.transaction(async (tx) => {
      const draft = await tx.structureVersion.findFirst({
        where: { structureId: id, status: 'DRAFT' },
      });
      if (draft) {
        return tx.structureVersion.update({ where: { id: draft.id }, data: { definition } });
      }
      const last = await tx.structureVersion.aggregate({
        where: { structureId: id },
        _max: { version: true },
      });
      return tx.structureVersion.create({
        data: {
          instanceId,
          structureId: id,
          version: (last._max.version ?? 0) + 1,
          definition,
        },
      });
    });
  }

  /** Publie le brouillon : il devient la version courante, l'ancienne est archivée. */
  async publish(id: string) {
    await this.ensureExists(id);
    return this.prisma.transaction(async (tx) => {
      const draft = await tx.structureVersion.findFirst({
        where: { structureId: id, status: 'DRAFT' },
      });
      if (!draft) {
        throw new ConflictException({ error: 'no_draft', message: 'Aucun brouillon à publier' });
      }
      assertValidDefinition(draft.definition);
      await tx.structureVersion.updateMany({
        where: { structureId: id, status: 'PUBLISHED' },
        data: { status: 'ARCHIVED' },
      });
      return tx.structureVersion.update({
        where: { id: draft.id },
        data: { status: 'PUBLISHED', publishedAt: new Date() },
      });
    });
  }

  private async ensureExists(id: string): Promise<void> {
    const found = await this.prisma.db.structure.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!found) throw new NotFoundException(NOT_FOUND);
  }

  private toDto(structure: {
    id: string;
    name: string;
    description: string | null;
    archivedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    versions: { version: number; status: string }[];
  }) {
    const current = structure.versions.find((v) => v.status === 'PUBLISHED');
    const draft = structure.versions.find((v) => v.status === 'DRAFT');
    return {
      id: structure.id,
      name: structure.name,
      description: structure.description,
      archivedAt: structure.archivedAt,
      currentVersion: current?.version ?? null,
      draftVersion: draft?.version ?? null,
      createdAt: structure.createdAt,
      updatedAt: structure.updatedAt,
    };
  }
}
