import { HttpException, Injectable } from '@nestjs/common';
import { StructureAccessService } from '../access/structure-access.service';
import { type Actor } from '../auth/decorators';
import { type Instance, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubmissionsService } from '../submissions/submissions.service';
import { TasksService, toTaskDto } from '../tasks/tasks.service';
import { decodeCursor, encodeCursor, nextCursor, type ResourceCursor } from './cursor';

export const PULL_PAGE_SIZE = 500;
/** Révisions renvoyées par fiche : l'historique complet reste consultable au back-office. */
export const HISTORY_LIMIT = 20;
export const MAX_PUSH_MUTATIONS = 100;

export type Mutation =
  | {
      id: string;
      type: 'create';
      submissionId: string;
      structureId: string;
      data: Record<string, unknown>;
      location?: { lat: number; lng: number; accuracy?: number };
      taskId?: string;
    }
  | {
      id: string;
      type: 'update';
      submissionId: string;
      baseRevision?: number;
      data: Record<string, unknown>;
    }
  | {
      id: string;
      type: 'transition';
      submissionId: string;
      transition: string;
      baseRevision?: number;
      data?: Record<string, unknown>;
    }
  | { id: string; type: 'delete'; submissionId: string };

export type MutationResult =
  | { id: string; status: 'applied' | 'duplicate'; submission?: unknown; conflicts?: string[] }
  | {
      id: string;
      status: 'rejected';
      error: { status: number; code: string; message: string; details?: unknown };
    };

type PagedTable = 'list_items' | 'submissions' | 'tasks' | 'notifications';

/**
 * Synchronisation hors ligne (P3.2, ADR 0007). Pull : changements depuis le curseur, par
 * ressource, tombstones comprises. Push : mutations rejouables, appliquées dans l'ordre, avec
 * les mêmes règles (droits, validation, conflits) que l'API classique.
 */
@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly submissions: SubmissionsService,
    private readonly access: StructureAccessService,
    private readonly tasks: TasksService,
  ) {}

  async pull(
    instance: Instance,
    actor: Actor,
    rawCursor: string | undefined,
    limit = PULL_PAGE_SIZE,
  ) {
    const cursor = decodeCursor(rawCursor);
    const [snapshot] = await this.prisma.transaction(
      (tx) =>
        tx.$queryRaw<
          { xmin: string }[]
        >`SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS xmin`,
    );
    const xmin = snapshot!.xmin;

    // Formulaires : liste complète (petite) avec les droits de l'appelant ; définitions des
    // versions courantes modifiées depuis le plancher (toutes à la première synchronisation).
    const structures = await this.prisma.db.structure.findMany({
      where: { archivedAt: null },
      include: {
        versions: { where: { status: 'PUBLISHED' }, select: { id: true, version: true } },
      },
      orderBy: { name: 'asc' },
    });
    const summaries = [];
    const readable: Prisma.Sql[] = [];
    for (const structure of structures) {
      const rights = await this.access.effective(structure.id, actor);
      if (rights.permissions.size === 0) continue;
      summaries.push({
        id: structure.id,
        name: structure.name,
        description: structure.description,
        currentVersionId: structure.versions[0]?.id ?? null,
        rights: [...rights.permissions].sort(),
      });
      const condition = await this.submissions.readCondition(structure.id, actor);
      if (condition) readable.push(condition);
    }
    const changedStructures = await this.prisma.transaction(
      (tx) => tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM structures WHERE sync_txid >= ${cursor.structures}::xid8`,
    );
    const changed = new Set(changedStructures.map(({ id }) => id));
    const versionIds = new Set(
      summaries
        .filter((s) => s.currentVersionId && changed.has(s.id))
        .map((s) => s.currentVersionId!),
    );

    const canReadLists =
      actor.permissions.has('list:read') || actor.permissions.has('instance:manage');
    const items = canReadLists
      ? await this.page('list_items', cursor.items, xmin, limit, Prisma.sql`TRUE`)
      : { ids: [], cursor: { floor: xmin }, hasMore: false };
    const submissionPage = await this.page(
      'submissions',
      cursor.submissions,
      xmin,
      limit,
      readable.length ? Prisma.sql`(${Prisma.join(readable, ' OR ')})` : Prisma.sql`FALSE`,
    );

    // Tâches : toute tâche modifiée est renvoyée ; celles qui ne sont pas (ou plus) assignées à
    // l'appelant le sont comme tombstones, pour retirer une tâche réassignée de son appareil.
    const empty = { ids: [] as string[], cursor: { floor: xmin }, hasMore: false };
    const taskPage = actor.userId
      ? await this.page('tasks', cursor.tasks, xmin, limit, Prisma.sql`TRUE`)
      : empty;
    const notificationPage = actor.userId
      ? await this.page(
          'notifications',
          cursor.notifications,
          xmin,
          limit,
          Prisma.sql`s.user_id = ${actor.userId}::uuid`,
        )
      : empty;
    const assigned = actor.userId
      ? new Set(
          (
            await this.prisma.db.task.findMany({
              where: {
                AND: [
                  { id: { in: taskPage.ids }, deletedAt: null },
                  await this.tasks.assignedTo(actor.userId),
                ],
              },
              select: { id: true },
            })
          ).map((t) => t.id),
        )
      : new Set<string>();

    const [lists, listItems, submissions, tasks, notifications] = await Promise.all([
      canReadLists
        ? this.prisma.db.list.findMany({
            select: { id: true, name: true, levels: true },
            orderBy: { name: 'asc' },
          })
        : [],
      this.prisma.db.listItem.findMany({ where: { id: { in: items.ids } } }),
      this.prisma.db.submission.findMany({
        where: { id: { in: submissionPage.ids } },
        include: { version: { select: { version: true } } },
      }),
      this.prisma.db.task.findMany({ where: { id: { in: [...assigned] } } }),
      this.prisma.db.notification.findMany({ where: { id: { in: notificationPage.ids } } }),
    ]);
    // Versions des fiches renvoyées : la saisie hors ligne d'une ancienne fiche en a besoin.
    for (const submission of submissions) versionIds.add(submission.structureVersionId);
    // Historique : toute écriture crée une révision et modifie la fiche, qui revient donc ici
    // avec ses dernières révisions (mêmes droits de lecture que la fiche).
    const history = await this.submissions.recentRevisions(
      submissions.filter((s) => !s.deletedAt).map((s) => s.id),
      HISTORY_LIMIT,
    );
    const versions = await this.prisma.db.structureVersion.findMany({
      where: { id: { in: [...versionIds] } },
      select: { id: true, structureId: true, version: true, definition: true },
    });

    return {
      cursor: encodeCursor({
        v: 1,
        structures: xmin,
        items: items.cursor,
        submissions: submissionPage.cursor,
        tasks: taskPage.cursor,
        notifications: notificationPage.cursor,
      }),
      hasMore:
        items.hasMore || submissionPage.hasMore || taskPage.hasMore || notificationPage.hasMore,
      settings: {
        name: instance.name,
        timeZone: instance.timeZone,
        branding: instance.branding,
        mobileMenu: instance.mobileMenu,
      },
      structures: summaries,
      versions,
      lists,
      listItems: listItems.map((item) => ({
        id: item.id,
        listId: item.listId,
        parentId: item.parentId,
        level: item.level,
        code: item.code,
        label: item.label,
        attributes: item.attributes,
        position: item.position,
        archived: item.archivedAt !== null,
      })),
      submissions: submissions.map((submission) =>
        submission.deletedAt
          ? { id: submission.id, structureId: submission.structureId, deleted: true }
          : {
              ...this.submissions.toDto(submission),
              deleted: false,
              history: history.get(submission.id)?.entries ?? [],
              historyTotal: history.get(submission.id)?.total ?? 0,
            },
      ),
      tasks: [
        ...tasks.map((task) => ({ ...toTaskDto(task), deleted: false })),
        ...taskPage.ids.filter((id) => !assigned.has(id)).map((id) => ({ id, deleted: true })),
      ],
      notifications: notifications.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        data: n.data,
        readAt: n.readAt,
        createdAt: n.createdAt,
      })),
    };
  }

  /** Page d'une ressource, triée par (sync_txid, id), à partir du curseur. */
  private async page(
    table: PagedTable,
    cursor: ResourceCursor,
    xmin: string,
    limit: number,
    condition: Prisma.Sql,
  ) {
    const start = cursor.pos ? cursor.start! : xmin;
    const after = cursor.pos
      ? Prisma.sql`AND (s.sync_txid, s.id) > (${cursor.pos.txid}::xid8, ${cursor.pos.id}::uuid)`
      : Prisma.empty;
    const rows = await this.prisma.transaction(
      (tx) => tx.$queryRaw<{ id: string; txid: string }[]>`
        SELECT s.id, s.sync_txid::text AS txid FROM ${Prisma.raw(table)} s
        WHERE ${condition} AND s.sync_txid >= ${cursor.floor}::xid8 ${after}
        ORDER BY s.sync_txid, s.id LIMIT ${limit + 1}`,
    );
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    return {
      ids: page.map((r) => r.id),
      cursor: nextCursor(cursor, start, page.at(-1), hasMore),
      hasMore,
    };
  }

  /**
   * Applique les mutations dans l'ordre. Une mutation refusée (droits, validation, fiche
   * introuvable) n'arrête pas le lot ; une erreur serveur l'interrompt : le client renverra
   * les mutations restantes, déjà appliquées comprises (sans effet grâce à l'idempotence).
   */
  async push(instance: Instance, actor: Actor, mutations: Mutation[]): Promise<MutationResult[]> {
    const results: MutationResult[] = [];
    for (const mutation of mutations) {
      try {
        if (mutation.type === 'create') {
          const result = await this.submissions.create(instance, mutation.structureId, actor, {
            id: mutation.submissionId,
            data: mutation.data,
            clientMutationId: mutation.id,
            ...(mutation.location ? { location: mutation.location } : {}),
            ...(mutation.taskId ? { taskId: mutation.taskId } : {}),
          });
          results.push({
            id: mutation.id,
            status: result.replayed ? 'duplicate' : 'applied',
            submission: result.submission,
          });
        } else if (mutation.type === 'update') {
          const result = await this.submissions.update(instance, mutation.submissionId, actor, {
            data: mutation.data,
            clientMutationId: mutation.id,
            ...(mutation.baseRevision !== undefined ? { baseRevision: mutation.baseRevision } : {}),
          });
          results.push({
            id: mutation.id,
            status: result.replayed ? 'duplicate' : 'applied',
            submission: result.submission,
            conflicts: result.conflicts,
          });
        } else if (mutation.type === 'transition') {
          const result = await this.submissions.transition(instance, mutation.submissionId, actor, {
            transition: mutation.transition,
            clientMutationId: mutation.id,
            ...(mutation.data ? { data: mutation.data } : {}),
            ...(mutation.baseRevision !== undefined ? { baseRevision: mutation.baseRevision } : {}),
          });
          results.push({
            id: mutation.id,
            status: result.replayed ? 'duplicate' : 'applied',
            submission: result.submission,
            conflicts: result.conflicts,
          });
        } else {
          await this.submissions.remove(instance, mutation.submissionId, actor, mutation.id);
          results.push({ id: mutation.id, status: 'applied' });
        }
      } catch (error) {
        if (!(error instanceof HttpException) || error.getStatus() >= 500) throw error;
        const response = error.getResponse() as Record<string, unknown>;
        results.push({
          id: mutation.id,
          status: 'rejected',
          error: {
            status: error.getStatus(),
            code: typeof response['error'] === 'string' ? response['error'] : 'error',
            message: typeof response['message'] === 'string' ? response['message'] : error.message,
            ...(response['details'] !== undefined ? { details: response['details'] } : {}),
          },
        });
      }
    }
    return results;
  }
}
