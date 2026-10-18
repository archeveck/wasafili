import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { type EvaluationContext, type FormEngine } from '@tesserax/form-engine';
import {
  COMPUTED_TYPES,
  initialState,
  type StructureDefinition,
  type SubmissionData,
  walkFields,
} from '@tesserax/form-schema';
import { type Actor } from '../auth/decorators';
import { pageArgs, type Pagination, toPage } from '../common/pagination';
import { type Instance, Prisma, type Submission } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { type TransactionClient } from '../prisma/tenant';
import { EngineCache } from '../structures/engine-cache';
import { StructuresService } from '../structures/structures.service';
import { diffData, jsonEqual } from './diff';
import { filterableFields, filterSql, type Filter, orderSql } from './query';

export interface Location {
  lat: number;
  lng: number;
  accuracy?: number;
}

export interface CreateSubmissionInput {
  id?: string;
  data: SubmissionData;
  clientMutationId?: string;
  location?: Location;
}

export interface UpdateSubmissionInput {
  data: SubmissionData;
  clientMutationId?: string;
}

export interface ListSubmissionsInput extends Pagination {
  sort?: string;
  state?: string;
  author_id?: string;
  filters: Filter[];
}

type SubmissionWithVersion = Submission & { version: { version: number } };

const NOT_FOUND = { error: 'not_found', message: 'Fiche introuvable' };

/** Clés des champs dont la valeur est fixée par le serveur ou le moteur, jamais par le client. */
function serverOwnedKeys(definition: StructureDefinition) {
  const root = new Set<string>();
  const cells = new Map<string, Set<string>>();
  for (const { field, table } of walkFields(definition.fields)) {
    if (!COMPUTED_TYPES.has(field.type)) continue;
    if (table) cells.set(table.key, (cells.get(table.key) ?? new Set()).add(field.key));
    else root.add(field.key);
  }
  return { root, cells };
}

/** Retire des données reçues les valeurs calculées et automatiques (recalculées ici). */
function stripServerOwned(definition: StructureDefinition, data: SubmissionData): SubmissionData {
  const { root, cells } = serverOwnedKeys(definition);
  const result: SubmissionData = {};
  for (const [key, value] of Object.entries(data)) {
    if (root.has(key)) continue;
    const owned = cells.get(key);
    result[key] =
      owned && Array.isArray(value)
        ? value.map((row: unknown) =>
            row && typeof row === 'object'
              ? Object.fromEntries(Object.entries(row).filter(([cell]) => !owned.has(cell)))
              : row,
          )
        : value;
  }
  return result;
}

@Injectable()
export class SubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly structures: StructuresService,
    private readonly engines: EngineCache,
  ) {}

  async list(structureId: string, actor: Actor, input: ListSubmissionsInput) {
    await this.structures.get(structureId);
    const version = await this.structures.currentVersion(structureId);
    const fields = filterableFields(version?.definition as StructureDefinition | undefined);

    const conditions = [
      Prisma.sql`s.structure_id = ${structureId}::uuid`,
      Prisma.sql`s.deleted_at IS NULL`,
      ...input.filters.map((filter) => filterSql(filter, fields)),
    ];
    const ownOnly = this.readScope(actor) === 'own';
    if (ownOnly) conditions.push(Prisma.sql`s.author_id = ${actor.userId}::uuid`);
    if (input.state) conditions.push(Prisma.sql`s.state = ${input.state}`);
    if (input.author_id) conditions.push(Prisma.sql`s.author_id = ${input.author_id}::uuid`);
    const where = Prisma.join(conditions, ' AND ');
    const order = orderSql(input.sort, fields);
    const { skip, take } = pageArgs(input);

    const [ids, total] = await this.prisma.transaction(async (tx) => [
      await tx.$queryRaw<{ id: string }[]>`
        SELECT s.id FROM submissions s WHERE ${where}
        ORDER BY ${order}, s.id LIMIT ${take} OFFSET ${skip}`,
      await tx.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM submissions s WHERE ${where}`,
    ]);
    const rows = await this.prisma.db.submission.findMany({
      where: { id: { in: ids.map(({ id }) => id) } },
      include: { version: { select: { version: true } } },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return toPage(
      ids.map(({ id }) => this.toDto(byId.get(id)!)),
      Number(total[0]!.count),
      input,
    );
  }

  async get(id: string, actor: Actor) {
    return this.toDto(await this.findVisible(this.prisma.db, id, actor));
  }

  async create(
    instance: Instance,
    structureId: string,
    actor: Actor,
    input: CreateSubmissionInput,
  ) {
    const replay = await this.replay(instance.id, input.clientMutationId, actor);
    if (replay && replay !== 'applied') return { replayed: true, submission: replay };

    await this.structures.get(structureId);
    const version = await this.structures.currentVersion(structureId);
    if (!version) {
      throw new ConflictException({
        error: 'no_published_version',
        message: "La structure n'a pas de version publiée",
      });
    }
    const definition = version.definition as StructureDefinition;
    const engine = this.engines.get(version);
    const state = initialState(definition.workflow);
    const context = this.context(instance, actor, state);

    const data = engine.applyDefaults(stripServerOwned(definition, input.data), context, {
      isNew: true,
    });
    const values = this.validated(engine, data, context);

    try {
      const id = await this.prisma.transaction(async (tx) => {
        const submission = await tx.submission.create({
          data: {
            ...(input.id ? { id: input.id } : {}),
            instanceId: instance.id,
            structureId,
            structureVersionId: version.id,
            data: values as Prisma.InputJsonValue,
            state,
            authorId: actor.userId,
            latitude: input.location?.lat ?? null,
            longitude: input.location?.lng ?? null,
            accuracy: input.location?.accuracy ?? null,
          },
        });
        await tx.submissionRevision.create({
          data: {
            instanceId: instance.id,
            submissionId: submission.id,
            revision: 1,
            action: 'create',
            authorId: actor.userId,
            clientMutationId: input.clientMutationId ?? null,
            changes: diffData({}, values) as unknown as Prisma.InputJsonValue,
          },
        });
        return submission.id;
      });
      return { replayed: false, submission: await this.get(id, actor) };
    } catch (error) {
      // Deux envois simultanés de la même mutation : le second rejoue le premier.
      const concurrent = await this.replay(instance.id, input.clientMutationId, actor);
      if (concurrent && concurrent !== 'applied') return { replayed: true, submission: concurrent };
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ error: 'conflict', message: 'Cette fiche existe déjà' });
      }
      throw error;
    }
  }

  /**
   * Modification partielle : seuls les champs fournis changent, les calculs sont refaits et la
   * fiche complète est revalidée contre sa version d'origine.
   */
  async update(instance: Instance, id: string, actor: Actor, input: UpdateSubmissionInput) {
    const replay = await this.replay(instance.id, input.clientMutationId, actor);
    if (replay && replay !== 'applied') return { replayed: true, submission: replay };

    const current = await this.findVisible(this.prisma.db, id, actor);
    const version = await this.prisma.db.structureVersion.findUniqueOrThrow({
      where: { id: current.structureVersionId },
    });
    const definition = version.definition as StructureDefinition;
    const engine = this.engines.get(version);
    const context = this.context(instance, actor, current.state);
    const before = current.data as SubmissionData;
    const incoming = stripServerOwned(definition, input.data);

    const state = engine.evaluate(before, context);
    const readOnly = Object.keys(incoming).filter(
      (key) => state.fields[key]?.readOnly && !jsonEqual(incoming[key], before[key]),
    );
    if (readOnly.length > 0) {
      throw new UnprocessableEntityException({
        error: 'invalid_data',
        message: 'Données de fiche invalides',
        details: readOnly.map((key) => ({ path: [key], field: key, code: 'read_only' })),
      });
    }

    const data = engine.applyDefaults({ ...before, ...incoming }, context, { isNew: false });
    const values = this.validated(engine, data, context);
    const updatedStamps = new Set(
      [...walkFields(definition.fields)]
        .filter(
          ({ field, table }) => !table && field.type === 'timestamp' && field.mode === 'updated',
        )
        .map(({ field }) => field.key),
    );
    const changes = diffData(before, values);
    if (changes.every((change) => updatedStamps.has(change.field))) {
      return { replayed: false, submission: this.toDto(current) };
    }

    await this.prisma.transaction(async (tx) => {
      // Verrou optimiste : une modification concurrente impose de relire la fiche.
      const { count } = await tx.submission.updateMany({
        where: { id, revision: current.revision },
        data: { data: values as Prisma.InputJsonValue, revision: current.revision + 1 },
      });
      if (count === 0) {
        throw new ConflictException({
          error: 'concurrent_update',
          message: 'La fiche a été modifiée entre-temps : rechargez-la',
        });
      }
      await tx.submissionRevision.create({
        data: {
          instanceId: instance.id,
          submissionId: id,
          revision: current.revision + 1,
          action: 'update',
          authorId: actor.userId,
          clientMutationId: input.clientMutationId ?? null,
          changes: changes as unknown as Prisma.InputJsonValue,
        },
      });
    });
    return { replayed: false, submission: await this.get(id, actor) };
  }

  /** Suppression logique, tracée dans l'historique. */
  async remove(instance: Instance, id: string, actor: Actor, clientMutationId?: string) {
    if ((await this.replay(instance.id, clientMutationId, actor)) === 'applied') return;
    const current = await this.findVisible(this.prisma.db, id, actor);
    await this.prisma.transaction(async (tx) => {
      const { count } = await tx.submission.updateMany({
        where: { id, revision: current.revision },
        data: { deletedAt: new Date(), revision: current.revision + 1 },
      });
      if (count === 0) {
        throw new ConflictException({
          error: 'concurrent_update',
          message: 'La fiche a été modifiée entre-temps : rechargez-la',
        });
      }
      await tx.submissionRevision.create({
        data: {
          instanceId: instance.id,
          submissionId: id,
          revision: current.revision + 1,
          action: 'delete',
          authorId: actor.userId,
          clientMutationId: clientMutationId ?? null,
          changes: [],
        },
      });
    });
  }

  async revisions(id: string, actor: Actor, pagination: Pagination) {
    await this.findVisible(this.prisma.db, id, actor);
    const where = { submissionId: id };
    const [revisions, total] = await Promise.all([
      this.prisma.db.submissionRevision.findMany({
        where,
        ...pageArgs(pagination),
        orderBy: { revision: 'desc' },
        select: {
          id: true,
          revision: true,
          action: true,
          authorId: true,
          clientMutationId: true,
          changes: true,
          createdAt: true,
        },
      }),
      this.prisma.db.submissionRevision.count({ where }),
    ]);
    return toPage(revisions, total, pagination);
  }

  private readScope(actor: Actor): 'all' | 'own' {
    if (actor.permissions.has('submission:read:all')) return 'all';
    if (actor.permissions.has('submission:read:own') && actor.userId) return 'own';
    throw new ForbiddenException({
      error: 'forbidden',
      message: 'Lecture des fiches non autorisée',
    });
  }

  private async findVisible(
    db: PrismaService['db'] | TransactionClient,
    id: string,
    actor: Actor,
  ): Promise<SubmissionWithVersion> {
    const submission = await db.submission.findFirst({
      where: {
        id,
        deletedAt: null,
        ...(this.readScope(actor) === 'own' ? { authorId: actor.userId } : {}),
      },
      include: { version: { select: { version: true } } },
    });
    if (!submission) throw new NotFoundException(NOT_FOUND);
    return submission;
  }

  /** Mutation déjà appliquée (même `clientMutationId`) : renvoie l'état courant sans rejouer. */
  private async replay(
    instanceId: string,
    clientMutationId: string | undefined,
    actor: Actor,
  ): Promise<ReturnType<SubmissionsService['toDto']> | 'applied' | undefined> {
    if (!clientMutationId) return undefined;
    const revision = await this.prisma.db.submissionRevision.findUnique({
      where: { instanceId_clientMutationId: { instanceId, clientMutationId } },
      select: { submissionId: true, action: true },
    });
    if (!revision) return undefined;
    if (revision.action === 'delete') return 'applied';
    return this.get(revision.submissionId, actor);
  }

  private context(instance: Instance, actor: Actor, state: string | null): EvaluationContext {
    return {
      ...(actor.userId ? { user: { id: actor.userId, roles: actor.roles } } : {}),
      state,
      now: new Date(),
      timeZone: instance.timeZone,
    };
  }

  private validated(
    engine: FormEngine,
    data: SubmissionData,
    context: EvaluationContext,
  ): SubmissionData {
    const result = engine.validate(data, context);
    if (!result.valid) {
      throw new UnprocessableEntityException({
        error: 'invalid_data',
        message: 'Données de fiche invalides',
        details: result.errors,
      });
    }
    return result.state.values;
  }

  private toDto(submission: SubmissionWithVersion) {
    return {
      id: submission.id,
      structureId: submission.structureId,
      structureVersionId: submission.structureVersionId,
      version: submission.version.version,
      state: submission.state,
      authorId: submission.authorId,
      revision: submission.revision,
      data: submission.data,
      location:
        submission.latitude === null || submission.longitude === null
          ? null
          : {
              lat: submission.latitude,
              lng: submission.longitude,
              accuracy: submission.accuracy,
            },
      createdAt: submission.createdAt,
      updatedAt: submission.updatedAt,
    };
  }
}
