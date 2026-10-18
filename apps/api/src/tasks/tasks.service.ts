import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { type Actor } from '../auth/decorators';
import { pageArgs, type Pagination, toPage } from '../common/pagination';
import { type Instance, Prisma, type Task } from '../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { type TransactionClient } from '../prisma/tenant';

export const TASK_STATUSES = ['todo', 'in_progress', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface TaskInput {
  title: string;
  description?: string | null;
  assigneeUserId?: string | null;
  assigneeGroupId?: string | null;
  startAt: Date;
  endAt: Date;
  dueAt?: Date | null;
  locationLabel?: string | null;
  location?: { lat: number; lng: number } | null;
  prefill?: Record<string, unknown>;
  status?: TaskStatus;
}

export interface ListTasksInput extends Pagination {
  from?: Date;
  to?: Date;
  structure_id?: string;
  assignee_user_id?: string;
  assignee_group_id?: string;
  status?: TaskStatus;
  /** Seulement les tâches assignées à l'appelant (directement ou par un groupe). */
  mine?: boolean;
}

const NOT_FOUND = { error: 'not_found', message: 'Tâche introuvable' };

/**
 * Tâches (P4.4). `task:manage` voit et planifie toutes les tâches ; `task:read` ne voit que
 * celles qui lui sont assignées, directement ou par l'un de ses groupes.
 */
@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Condition Prisma des tâches assignées à l'utilisateur. */
  async assignedTo(userId: string): Promise<Prisma.TaskWhereInput> {
    const groups = await this.prisma.db.groupMember.findMany({
      where: { userId },
      select: { groupId: true },
    });
    return {
      OR: [{ assigneeUserId: userId }, { assigneeGroupId: { in: groups.map((g) => g.groupId) } }],
    };
  }

  /** Condition SQL (alias `t`) équivalente, pour la synchronisation. */
  assignedSql(userId: string): Prisma.Sql {
    return Prisma.sql`(t.assignee_user_id = ${userId}::uuid OR t.assignee_group_id IN (
      SELECT group_id FROM group_members WHERE user_id = ${userId}::uuid))`;
  }

  async list(actor: Actor, input: ListTasksInput) {
    const scope = await this.scope(actor, input.mine);
    const where: Prisma.TaskWhereInput = {
      AND: [
        scope,
        { deletedAt: null },
        input.from ? { endAt: { gt: input.from } } : {},
        input.to ? { startAt: { lt: input.to } } : {},
        input.structure_id ? { structureId: input.structure_id } : {},
        input.assignee_user_id ? { assigneeUserId: input.assignee_user_id } : {},
        input.assignee_group_id ? { assigneeGroupId: input.assignee_group_id } : {},
        input.status ? { status: input.status } : {},
      ],
    };
    const [tasks, total] = await Promise.all([
      this.prisma.db.task.findMany({
        where,
        orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
        ...pageArgs(input),
      }),
      this.prisma.db.task.count({ where }),
    ]);
    return toPage(tasks.map(toTaskDto), total, input);
  }

  async get(id: string, actor: Actor) {
    return toTaskDto(await this.findVisible(id, actor));
  }

  async create(
    instance: Instance,
    actor: Actor,
    input: TaskInput & { id?: string; structureId: string },
  ) {
    await this.checkReferences({ ...input, structureId: input.structureId });
    const { task, notified } = await this.prisma.transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          ...(input.id ? { id: input.id } : {}),
          instanceId: instance.id,
          structureId: input.structureId,
          createdById: actor.userId,
          ...columns(input),
          title: input.title,
          startAt: input.startAt,
          endAt: input.endAt,
        },
      });
      return { task, notified: await this.notifyAssignees(tx, instance, actor, task) };
    });
    await this.notifications.dispatch(instance.id, notified);
    return toTaskDto(task);
  }

  /** Replanification, réassignation, changement de statut (glisser-déposer de l'agenda). */
  async update(instance: Instance, id: string, actor: Actor, input: Partial<TaskInput>) {
    const current = await this.findVisible(id, actor);
    const next = {
      startAt: input.startAt ?? current.startAt,
      endAt: input.endAt ?? current.endAt,
      assigneeUserId:
        input.assigneeUserId !== undefined ? input.assigneeUserId : current.assigneeUserId,
      assigneeGroupId:
        input.assigneeGroupId !== undefined ? input.assigneeGroupId : current.assigneeGroupId,
    };
    // Assigner à un utilisateur retire le groupe, et inversement.
    if (input.assigneeUserId) next.assigneeGroupId = null;
    if (input.assigneeGroupId) next.assigneeUserId = null;
    await this.checkReferences({ ...next, structureId: current.structureId });

    const { task, notified } = await this.prisma.transaction(async (tx) => {
      const task = await tx.task.update({
        where: { id },
        data: columns({ ...input, ...next }),
      });
      const reassigned =
        task.assigneeUserId !== current.assigneeUserId ||
        task.assigneeGroupId !== current.assigneeGroupId;
      return {
        task,
        notified: reassigned ? await this.notifyAssignees(tx, instance, actor, task) : [],
      };
    });
    await this.notifications.dispatch(instance.id, notified);
    return toTaskDto(task);
  }

  async remove(id: string, actor: Actor) {
    await this.findVisible(id, actor);
    await this.prisma.db.task.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /**
   * Clôture d'une tâche par la fiche créée depuis celle-ci (dans la transaction de création).
   * Une tâche disparue, annulée, déjà close, d'un autre formulaire ou que l'appelant ne voit
   * pas n'est pas liée : la fiche est enregistrée quand même (saisie hors ligne jamais perdue).
   */
  async completeWithSubmission(
    tx: TransactionClient,
    actor: Actor,
    taskId: string,
    submission: { id: string; structureId: string },
  ): Promise<boolean> {
    const scope = await this.scope(actor);
    const { count } = await tx.task.updateMany({
      where: {
        AND: [
          scope,
          {
            id: taskId,
            deletedAt: null,
            structureId: submission.structureId,
            status: { in: ['todo', 'in_progress'] },
            submissionId: null,
          },
        ],
      },
      data: { status: 'done', submissionId: submission.id },
    });
    return count > 0;
  }

  private async scope(actor: Actor, mine = false): Promise<Prisma.TaskWhereInput> {
    if (actor.permissions.has('task:manage') && !mine) return {};
    if (
      (actor.permissions.has('task:read') || actor.permissions.has('task:manage')) &&
      actor.userId
    ) {
      return this.assignedTo(actor.userId);
    }
    throw new ForbiddenException({ error: 'forbidden', message: 'Accès aux tâches non autorisé' });
  }

  private async findVisible(id: string, actor: Actor): Promise<Task> {
    const scope = await this.scope(actor);
    const task = await this.prisma.db.task.findFirst({
      where: { AND: [scope, { id, deletedAt: null }] },
    });
    if (!task) throw new NotFoundException(NOT_FOUND);
    return task;
  }

  private async checkReferences(input: {
    structureId: string;
    startAt: Date;
    endAt: Date;
    assigneeUserId?: string | null;
    assigneeGroupId?: string | null;
  }) {
    const invalid = (message: string) =>
      new UnprocessableEntityException({ error: 'invalid_task', message });
    if (input.endAt <= input.startAt) throw invalid('La fin doit suivre le début');
    if (input.assigneeUserId && input.assigneeGroupId) {
      throw invalid('Une tâche est assignée à un utilisateur ou à un groupe, pas aux deux');
    }
    const structure = await this.prisma.db.structure.findFirst({
      where: { id: input.structureId, archivedAt: null },
      select: { id: true },
    });
    if (!structure) throw invalid('Formulaire introuvable');
    if (
      input.assigneeUserId &&
      !(await this.prisma.db.membership.findFirst({ where: { userId: input.assigneeUserId } }))
    ) {
      throw invalid("L'utilisateur assigné n'est pas membre de l'instance");
    }
    if (
      input.assigneeGroupId &&
      !(await this.prisma.db.group.findFirst({ where: { id: input.assigneeGroupId } }))
    ) {
      throw invalid('Groupe introuvable');
    }
  }

  private async notifyAssignees(
    tx: TransactionClient,
    instance: Instance,
    actor: Actor,
    task: Task,
  ): Promise<string[]> {
    const recipients = task.assigneeUserId
      ? [task.assigneeUserId]
      : task.assigneeGroupId
        ? (
            await tx.groupMember.findMany({
              where: { groupId: task.assigneeGroupId },
              select: { userId: true },
            })
          ).map((m) => m.userId)
        : [];
    const when = new Intl.DateTimeFormat('fr-FR', {
      timeZone: instance.timeZone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(task.startAt);
    return this.notifications.notify(tx, instance.id, recipients, actor.userId, {
      type: 'task_assigned',
      title: 'Nouvelle tâche',
      body: `${task.title} — ${when}`,
      data: { taskId: task.id, structureId: task.structureId },
    });
  }
}

function location(input: Partial<TaskInput>) {
  if (input.location === undefined) return {};
  return { latitude: input.location?.lat ?? null, longitude: input.location?.lng ?? null };
}

function columns(input: Partial<TaskInput>) {
  return {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.assigneeUserId !== undefined ? { assigneeUserId: input.assigneeUserId } : {}),
    ...(input.assigneeGroupId !== undefined ? { assigneeGroupId: input.assigneeGroupId } : {}),
    ...(input.startAt !== undefined ? { startAt: input.startAt } : {}),
    ...(input.endAt !== undefined ? { endAt: input.endAt } : {}),
    ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
    ...(input.locationLabel !== undefined ? { locationLabel: input.locationLabel } : {}),
    ...(input.prefill !== undefined ? { prefill: input.prefill as Prisma.InputJsonValue } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...location(input),
  } as const;
}

export function toTaskDto(task: Task) {
  return {
    id: task.id,
    structureId: task.structureId,
    title: task.title,
    description: task.description,
    assigneeUserId: task.assigneeUserId,
    assigneeGroupId: task.assigneeGroupId,
    startAt: task.startAt,
    endAt: task.endAt,
    dueAt: task.dueAt,
    locationLabel: task.locationLabel,
    location:
      task.latitude === null || task.longitude === null
        ? null
        : { lat: task.latitude, lng: task.longitude },
    prefill: task.prefill,
    status: task.status,
    submissionId: task.submissionId,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}
