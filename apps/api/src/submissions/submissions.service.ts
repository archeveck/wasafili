import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { checkTransition, type EvaluationContext, type FormEngine } from '@tesserax/form-engine';
import {
  COMPUTED_TYPES,
  initialState,
  type StructureDefinition,
  type SubmissionData,
  walkFields,
} from '@tesserax/form-schema';
import {
  StructureAccessService,
  type StructurePermission,
  type StructureRights,
} from '../access/structure-access.service';
import { type Actor } from '../auth/decorators';
import { pageArgs, type Pagination, toPage } from '../common/pagination';
import { type Instance, Prisma, type Submission } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { type TransactionClient } from '../prisma/tenant';
import { EngineCache } from '../structures/engine-cache';
import { StructuresService } from '../structures/structures.service';
import { writeSpreadsheet, type SpreadsheetFormat } from '../lists/spreadsheet';
import { diffData, type FieldChange, jsonEqual } from './diff';
import { exportColumns, formatCell, referencedIds } from './export';
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
  /** Révision sur laquelle le client a fondé sa modification (détection des conflits). */
  baseRevision?: number;
}

export interface TransitionInput {
  transition: string;
  /** Modifications enregistrées avec la transition (bouton d'enregistrement). */
  data?: SubmissionData;
  clientMutationId?: string;
  baseRevision?: number;
}

export interface ListSubmissionsInput extends Pagination {
  sort?: string;
  state?: string;
  author_id?: string;
  filters: Filter[];
}

type SubmissionWithVersion = Submission & { version: { version: number } };

const NOT_FOUND = { error: 'not_found', message: 'Fiche introuvable' };
const MAX_EXPORT_ROWS = 50_000;

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

/** Pseudo-champ de l'historique pour un changement d'état (jamais une clé de champ). */
export const STATE_CHANGE = '$state';

/** Refus de transition expliqué (P4.1.4) : l'utilisateur hors ligne doit comprendre pourquoi. */
function transitionRefused(
  definition: StructureDefinition,
  state: string | null,
  key: string,
  refusal: 'no_workflow' | 'unknown_transition' | 'wrong_state' | 'role',
) {
  const workflow = definition.workflow;
  const label = (stateKey: string | null) =>
    workflow?.states.find((s) => s.key === stateKey)?.label ?? stateKey ?? '—';
  const transition = workflow?.transitions.find((t) => t.key === key);
  switch (refusal) {
    case 'no_workflow':
      return new ConflictException({
        error: 'no_workflow',
        message: 'Ce formulaire n’a pas de workflow',
      });
    case 'unknown_transition':
      return new UnprocessableEntityException({
        error: 'unknown_transition',
        message: `Transition inconnue : ${key}`,
      });
    case 'wrong_state':
      return new ConflictException({
        error: 'invalid_state',
        message: `La fiche est à l’état « ${label(state)} » : « ${transition!.label} » n’est plus possible`,
        details: { state, from: transition!.from },
      });
    case 'role':
      return new ForbiddenException({
        error: 'forbidden',
        message: `Votre rôle ne permet pas « ${transition!.label} »`,
      });
  }
}

@Injectable()
export class SubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly structures: StructuresService,
    private readonly engines: EngineCache,
    private readonly access: StructureAccessService,
  ) {}

  async list(structureId: string, actor: Actor, input: ListSubmissionsInput) {
    const { where, order } = await this.query(structureId, actor, input);
    const { skip, take } = pageArgs(input);
    const [ids, total] = await this.prisma.transaction(async (tx) => [
      await tx.$queryRaw<{ id: string }[]>`
        SELECT s.id FROM submissions s WHERE ${where}
        ORDER BY ${order}, s.id LIMIT ${take} OFFSET ${skip}`,
      await tx.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM submissions s WHERE ${where}`,
    ]);
    const rows = await this.load(ids.map(({ id }) => id));
    return toPage(
      rows.map((row) => this.toDto(row)),
      Number(total[0]!.count),
      input,
    );
  }

  /** Compteurs par état (filtres de la liste, hors filtre d'état). */
  async stateCounts(
    structureId: string,
    actor: Actor,
    input: Omit<ListSubmissionsInput, 'page' | 'per_page'>,
  ) {
    const { where } = await this.query(structureId, actor, { ...input, state: undefined });
    const rows = await this.prisma.transaction(
      (tx) => tx.$queryRaw<{ state: string | null; count: bigint }[]>`
        SELECT s.state, count(*) FROM submissions s WHERE ${where} GROUP BY s.state ORDER BY s.state`,
    );
    return rows.map((row) => ({ state: row.state, count: Number(row.count) }));
  }

  /** Export tableur des fiches visibles, avec les mêmes filtres que la liste (P2.5.4). */
  async export(
    structureId: string,
    actor: Actor,
    input: Omit<ListSubmissionsInput, 'page' | 'per_page'>,
    format: SpreadsheetFormat,
  ) {
    const rights = await this.access.effective(structureId, actor);
    this.require(rights, 'export');
    const { where, order, definition } = await this.query(structureId, actor, input, rights);
    const ids = await this.prisma.transaction(
      (tx) => tx.$queryRaw<{ id: string }[]>`
        SELECT s.id FROM submissions s WHERE ${where}
        ORDER BY ${order}, s.id LIMIT ${MAX_EXPORT_ROWS + 1}`,
    );
    if (ids.length > MAX_EXPORT_ROWS) {
      throw new UnprocessableEntityException({
        error: 'export_too_large',
        message: `Export limité à ${MAX_EXPORT_ROWS} fiches : affinez les filtres`,
      });
    }
    const rows = await this.load(ids.map(({ id }) => id));
    const fields = definition ? exportColumns(definition) : [];
    const data = rows.map((row) => row.data as Record<string, unknown>);
    const refs = referencedIds(fields, data);
    const [items, users] = await Promise.all([
      this.prisma.db.listItem.findMany({
        where: { id: { in: refs.items } },
        select: { id: true, label: true },
      }),
      this.prisma.db.user.findMany({
        where: {
          id: { in: [...refs.users, ...rows.flatMap((r) => (r.authorId ? [r.authorId] : []))] },
        },
        select: { id: true, email: true },
      }),
    ]);
    const labels = {
      items: new Map(items.map((item) => [item.id, item.label])),
      users: new Map(users.map((user) => [user.id, user.email])),
    };
    const headers = [
      'ID',
      'Créée le',
      'Modifiée le',
      'État',
      'Auteur',
      ...fields.map((f) => f.label),
    ];
    const table = rows.map((row, index) => {
      const values = data[index]!;
      return Object.fromEntries([
        ['ID', row.id],
        ['Créée le', row.createdAt.toISOString()],
        ['Modifiée le', row.updatedAt.toISOString()],
        ['État', row.state ?? ''],
        ['Auteur', row.authorId ? (labels.users.get(row.authorId) ?? '') : ''],
        ...fields.map((field) => [field.label, formatCell(field, values[field.key], labels)]),
      ]);
    });
    return writeSpreadsheet(format, { headers: [...new Set(headers)], rows: table });
  }

  /**
   * Condition SQL (alias `s`) des fiches d'une structure lisibles par l'appelant, fiches
   * supprimées comprises (tombstones de synchronisation) ; `null` sans droit de lecture.
   */
  async readCondition(structureId: string, actor: Actor): Promise<Prisma.Sql | null> {
    const rights = await this.access.effective(structureId, actor);
    const scope = rights.permissions.has('read:all')
      ? 'all'
      : rights.permissions.has('read:own') && actor.userId
        ? 'own'
        : undefined;
    if (!scope) return null;
    const version = await this.structures.currentVersion(structureId);
    const parts = [
      Prisma.sql`s.structure_id = ${structureId}::uuid`,
      this.access.visibilitySql(
        rights,
        actor,
        version?.definition as StructureDefinition | undefined,
      ),
    ];
    if (scope === 'own') parts.push(Prisma.sql`s.author_id = ${actor.userId}::uuid`);
    return Prisma.sql`(${Prisma.join(parts, ' AND ')})`;
  }

  /** Conflits d'une fiche (P3.7), non résolus d'abord. */
  async conflicts(id: string, actor: Actor) {
    await this.findVisible(id, actor);
    return this.prisma.db.submissionConflict.findMany({
      where: { submissionId: id },
      orderBy: [{ resolvedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
    });
  }

  /**
   * Résolution manuelle d'un conflit : conserver la valeur appliquée, ou rétablir la valeur
   * écrasée (nouvelle révision, tracée dans l'historique).
   */
  async resolveConflict(
    instance: Instance,
    id: string,
    conflictId: string,
    actor: Actor,
    resolution: 'kept' | 'restored',
  ) {
    const conflict = await this.prisma.db.submissionConflict.findFirst({
      where: { id: conflictId, submissionId: id },
    });
    if (!conflict)
      throw new NotFoundException({ error: 'not_found', message: 'Conflit introuvable' });
    if (conflict.resolvedAt) {
      throw new ConflictException({ error: 'conflict', message: 'Conflit déjà résolu' });
    }
    if (resolution === 'restored') {
      const value = (conflict.overwrittenValue as { value: unknown }).value;
      await this.update(instance, id, actor, { data: { [conflict.field]: value } });
    } else {
      const { rights } = await this.findVisible(id, actor);
      this.require(rights, 'update');
    }
    return this.prisma.db.submissionConflict.update({
      where: { id: conflictId },
      data: { resolution, resolvedAt: new Date(), resolvedById: actor.userId },
    });
  }

  /** Conditions SQL communes à la liste et à l'export : périmètre, visibilité, filtres. */
  private async query(
    structureId: string,
    actor: Actor,
    input: Omit<ListSubmissionsInput, 'page' | 'per_page'>,
    known?: StructureRights,
  ) {
    await this.structures.get(structureId);
    const rights = known ?? (await this.access.effective(structureId, actor));
    const scope = this.readScope(rights, actor);
    const version = await this.structures.currentVersion(structureId);
    const definition = version?.definition as StructureDefinition | undefined;
    const fields = filterableFields(definition);

    const conditions = [
      Prisma.sql`s.structure_id = ${structureId}::uuid`,
      Prisma.sql`s.deleted_at IS NULL`,
      this.access.visibilitySql(rights, actor, definition),
      ...input.filters.map((filter) => filterSql(filter, fields)),
    ];
    if (scope === 'own') conditions.push(Prisma.sql`s.author_id = ${actor.userId}::uuid`);
    if (input.state) conditions.push(Prisma.sql`s.state = ${input.state}`);
    if (input.author_id) conditions.push(Prisma.sql`s.author_id = ${input.author_id}::uuid`);
    return {
      where: Prisma.join(conditions, ' AND '),
      order: orderSql(input.sort, fields),
      definition,
    };
  }

  private async load(ids: string[]): Promise<SubmissionWithVersion[]> {
    const rows = await this.prisma.db.submission.findMany({
      where: { id: { in: ids } },
      include: { version: { select: { version: true } } },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.map((id) => byId.get(id)!);
  }

  async get(id: string, actor: Actor) {
    return this.toDto((await this.findVisible(id, actor)).submission);
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
    this.require(await this.access.effective(structureId, actor), 'create');
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
   *
   * Concurrence (D9) : les écritures sur une fiche sont sérialisées par un verrou de ligne. Si
   * `baseRevision` est antérieure à la révision courante, chaque champ fourni qui a aussi été
   * modifié depuis est un conflit : la dernière écriture reçue gagne et la valeur écrasée est
   * enregistrée (`SubmissionConflict`). Des champs différents fusionnent sans conflit.
   */
  async update(instance: Instance, id: string, actor: Actor, input: UpdateSubmissionInput) {
    return this.write(instance, id, actor, input);
  }

  /**
   * Transition de workflow (P4.1.2) : vérifie l'état de départ, le rôle et les données (avec
   * les modifications fournies), puis change l'état. Une seule révision `transition` porte les
   * champs modifiés et le changement d'état (`$state`) ; elle sert de journal d'événements.
   */
  async transition(instance: Instance, id: string, actor: Actor, input: TransitionInput) {
    return this.write(instance, id, actor, {
      data: input.data ?? {},
      transition: input.transition,
      ...(input.clientMutationId ? { clientMutationId: input.clientMutationId } : {}),
      ...(input.baseRevision !== undefined ? { baseRevision: input.baseRevision } : {}),
    });
  }

  private async write(
    instance: Instance,
    id: string,
    actor: Actor,
    input: UpdateSubmissionInput & { transition?: string },
  ) {
    const replay = await this.replay(instance.id, input.clientMutationId, actor);
    if (replay && replay !== 'applied')
      return { replayed: true, submission: replay, conflicts: [] };

    const { rights } = await this.findVisible(id, actor);
    this.require(rights, 'update');

    const conflicts = await this.prisma.transaction(async (tx) => {
      const current = await this.lock(tx, id);
      const version = await tx.structureVersion.findUniqueOrThrow({
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
      let values: SubmissionData;
      let nextState = current.state;
      if (input.transition === undefined) {
        values = this.validated(engine, data, context);
      } else {
        const check = checkTransition(engine, data, input.transition, context);
        if (check.refusal)
          throw transitionRefused(definition, current.state, input.transition, check.refusal);
        if (!check.ok) {
          throw new UnprocessableEntityException({
            error: 'invalid_data',
            message: 'Données de fiche invalides pour cette transition',
            details: check.errors,
          });
        }
        values = engine.calculate(data, context);
        nextState = check.transition!.to;
      }
      const updatedStamps = new Set(
        [...walkFields(definition.fields)]
          .filter(
            ({ field, table }) => !table && field.type === 'timestamp' && field.mode === 'updated',
          )
          .map(({ field }) => field.key),
      );
      const changes = diffData(before, values);
      if (
        input.transition === undefined &&
        changes.every((change) => updatedStamps.has(change.field))
      ) {
        return [];
      }
      if (nextState !== current.state) {
        changes.push({ field: STATE_CHANGE, before: current.state, after: nextState });
      }

      let conflicting: string[] = [];
      if (input.baseRevision !== undefined && input.baseRevision < current.revision) {
        const later = await tx.submissionRevision.findMany({
          where: { submissionId: id, revision: { gt: input.baseRevision } },
          select: { changes: true },
        });
        const touched = new Set(
          later.flatMap((r) => (r.changes as unknown as FieldChange[]).map((c) => c.field)),
        );
        conflicting = Object.keys(incoming).filter(
          (key) => touched.has(key) && !jsonEqual(incoming[key], before[key]),
        );
      }

      const revision = current.revision + 1;
      await tx.submission.update({
        where: { id },
        data: { data: values as Prisma.InputJsonValue, revision, state: nextState },
      });
      await tx.submissionRevision.create({
        data: {
          instanceId: instance.id,
          submissionId: id,
          revision,
          action: input.transition === undefined ? 'update' : 'transition',
          authorId: actor.userId,
          clientMutationId: input.clientMutationId ?? null,
          changes: changes as unknown as Prisma.InputJsonValue,
        },
      });
      if (conflicting.length > 0) {
        await tx.submissionConflict.createMany({
          data: conflicting.map((field) => ({
            instanceId: instance.id,
            submissionId: id,
            field,
            baseRevision: input.baseRevision!,
            appliedRevision: revision,
            appliedValue: { value: values[field] ?? null } as Prisma.InputJsonValue,
            overwrittenValue: { value: before[field] ?? null } as Prisma.InputJsonValue,
            clientMutationId: input.clientMutationId ?? null,
            authorId: actor.userId,
          })),
        });
      }
      return conflicting;
    });
    return { replayed: false, submission: await this.get(id, actor), conflicts };
  }

  /** Suppression logique, tracée dans l'historique. */
  async remove(instance: Instance, id: string, actor: Actor, clientMutationId?: string) {
    if ((await this.replay(instance.id, clientMutationId, actor)) === 'applied') return;
    const { rights } = await this.findVisible(id, actor);
    this.require(rights, 'delete');
    await this.prisma.transaction(async (tx) => {
      const current = await this.lock(tx, id);
      await tx.submission.update({
        where: { id },
        data: { deletedAt: new Date(), revision: current.revision + 1 },
      });
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

  /** Verrouille la fiche pour la transaction (écritures sérialisées) ; 404 si supprimée. */
  private async lock(tx: TransactionClient, id: string) {
    await tx.$queryRaw`SELECT id FROM submissions WHERE id = ${id}::uuid FOR UPDATE`;
    const current = await tx.submission.findUnique({ where: { id } });
    if (!current || current.deletedAt) throw new NotFoundException(NOT_FOUND);
    return current;
  }

  async revisions(id: string, actor: Actor, pagination: Pagination) {
    await this.findVisible(id, actor);
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

  private readScope(rights: StructureRights, actor: Actor): 'all' | 'own' {
    if (rights.permissions.has('read:all')) return 'all';
    if (rights.permissions.has('read:own') && actor.userId) return 'own';
    throw new ForbiddenException({
      error: 'forbidden',
      message: 'Lecture des fiches non autorisée',
    });
  }

  private require(rights: StructureRights, permission: StructurePermission): void {
    if (!rights.permissions.has(permission)) {
      throw new ForbiddenException({
        error: 'forbidden',
        message: `Droit manquant sur cette structure : ${permission}`,
      });
    }
  }

  /** Fiche lisible par l'appelant (périmètre et filtres de visibilité), sinon 404. */
  private async findVisible(id: string, actor: Actor) {
    const submission = await this.prisma.db.submission.findFirst({
      where: { id, deletedAt: null },
      include: { version: { select: { version: true } } },
    });
    if (!submission) throw new NotFoundException(NOT_FOUND);
    const rights = await this.access.effective(submission.structureId, actor);
    const scope = this.readScope(rights, actor);
    if (scope === 'own' && submission.authorId !== actor.userId) {
      throw new NotFoundException(NOT_FOUND);
    }
    if (rights.visibility) {
      const version = await this.structures.currentVersion(submission.structureId);
      const visibility = this.access.visibilitySql(
        rights,
        actor,
        version?.definition as StructureDefinition | undefined,
      );
      const [visible] = await this.prisma.transaction(
        (tx) => tx.$queryRaw<{ id: string }[]>`
          SELECT s.id FROM submissions s WHERE s.id = ${id}::uuid AND ${visibility}`,
      );
      if (!visible) throw new NotFoundException(NOT_FOUND);
    }
    return { submission, rights };
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

  toDto(submission: SubmissionWithVersion) {
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
