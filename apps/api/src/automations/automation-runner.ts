import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { dayIn } from '@wasafili/form-engine';
import {
  COMPUTED_TYPES,
  rootValueFields,
  type StructureDefinition,
  type SubmissionData,
} from '@wasafili/form-schema';
import { UnrecoverableError } from 'bullmq';
import { createHash } from 'node:crypto';
import { type Actor } from '../auth/decorators';
import { ENV, type Env } from '../config/env';
import { EmailsService } from '../emails/emails.service';
import { submissionPayload } from '../events/events.service';
import {
  type Automation,
  type AutomationRun,
  type Instance,
  Prisma,
  type Submission,
} from '../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { type TransactionClient } from '../prisma/tenant';
import { ReportsService } from '../reports/reports.service';
import { formatDateTime } from '../reports/report-data';
import { renderText } from '../reports/docx';
import { SubmissionsService } from '../submissions/submissions.service';
import { TasksService } from '../tasks/tasks.service';
import { PERMISSIONS } from '../tenancy/permissions';
import { WebhooksService } from '../webhooks/webhooks.service';
import { type Action, type Recipient } from './automation-schema';
import { addDays, zonedTime } from './zoned';

/** Acteur des automatisations : tous les droits de l'instance, aucun utilisateur. */
export const SYSTEM_ACTOR: Actor = {
  userId: null,
  roles: [],
  permissions: new Set(PERMISSIONS),
  roleId: null,
  attributes: {},
};

export interface Step {
  type: Action['type'];
  status: 'done' | 'failed';
  startedAt: string;
  durationMs: number;
  error?: string;
  result?: Record<string, unknown>;
}

/** Identifiant stable d'un effet d'étape : rejouer l'étape ne le crée pas deux fois. */
function stableUuid(...parts: string[]): string {
  const hex = createHash('sha256').update(parts.join(':')).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Erreur définitive (donnée, droit, configuration) : inutile de réessayer. */
function permanent(error: unknown): boolean {
  return error instanceof HttpException && error.getStatus() < 500;
}

function message(error: unknown): string {
  if (error instanceof HttpException) {
    const body = error.getResponse() as { message?: unknown };
    return typeof body.message === 'string' ? body.message : error.message;
  }
  return (error as Error).message;
}

interface RunContext {
  instance: Instance;
  automation: Automation;
  run: AutomationRun;
  submission: Submission | null;
  /** Données de fusion des textes (balises des rapports, `{{_lien}}`). */
  data: Record<string, unknown>;
}

/**
 * Exécution des automatisations (P5.3). Les actions passent par les services métier, avec les
 * droits de l'instance ; chaque étape réussie est enregistrée avec son effet (même transaction
 * quand c'est possible, sinon identifiant stable), si bien qu'une reprise après échec ne
 * refait que ce qui manque.
 */
@Injectable()
export class AutomationRunner {
  private readonly logger = new Logger(AutomationRunner.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly submissions: SubmissionsService,
    private readonly tasks: TasksService,
    private readonly notifications: NotificationsService,
    private readonly reports: ReportsService,
    private readonly emails: EmailsService,
    private readonly webhooks: WebhooksService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Tick d'un déclencheur planifié : une exécution par échéance (clé du job). */
  async scheduled(instanceId: string, automationId: string, tick: string): Promise<string | null> {
    const automation = await this.prisma.db.automation.findUnique({ where: { id: automationId } });
    if (!automation || automation.deletedAt || !automation.enabled) return null;
    const run = await this.prisma.db.automationRun.upsert({
      where: { automationId_eventKey: { automationId, eventKey: `schedule:${tick}` } },
      create: {
        instanceId,
        automationId,
        eventKey: `schedule:${tick}`,
        event: { type: 'schedule', at: new Date().toISOString() },
      },
      update: {},
    });
    await this.execute(run.id, true);
    return run.id;
  }

  /**
   * Exécute (ou reprend) une exécution. `final` : dernière tentative de la file ; un échec
   * devient alors définitif. Lève une erreur pour que la file réessaie.
   */
  async execute(runId: string, final: boolean): Promise<void> {
    const run = await this.prisma.db.automationRun.findUnique({ where: { id: runId } });
    if (!run || run.status === 'succeeded' || run.status === 'skipped') return;
    const automation = await this.prisma.db.automation.findUniqueOrThrow({
      where: { id: run.automationId },
    });
    if (automation.deletedAt || !automation.enabled) {
      await this.finish(
        run,
        'skipped',
        automation.deletedAt ? 'Automatisation supprimée' : 'Automatisation désactivée',
      );
      return;
    }
    const startedAt = run.startedAt ?? new Date();
    await this.prisma.db.automationRun.update({
      where: { id: run.id },
      data: { status: 'running', attempts: { increment: 1 }, startedAt, error: null },
    });

    const steps = [...((run.steps as unknown as Step[]) ?? [])];
    const actions = automation.actions as unknown as Action[];
    let context: RunContext;
    try {
      context = await this.context(run, automation);
    } catch (error) {
      await this.fail(run, startedAt, steps, message(error), final || permanent(error));
      throw permanent(error) ? new UnrecoverableError(message(error)) : error;
    }

    for (const [index, action] of actions.entries()) {
      if (steps[index]?.status === 'done') continue;
      const started = new Date();
      try {
        const result = await this.perform(
          context,
          action,
          index,
          (result) => ({
            type: action.type,
            status: 'done',
            startedAt: started.toISOString(),
            durationMs: Date.now() - started.getTime(),
            result,
          }),
          steps,
        );
        steps[index] = {
          type: action.type,
          status: 'done',
          startedAt: started.toISOString(),
          durationMs: Date.now() - started.getTime(),
          result,
        };
        await this.saveSteps(run.id, steps);
      } catch (error) {
        steps[index] = {
          type: action.type,
          status: 'failed',
          startedAt: started.toISOString(),
          durationMs: Date.now() - started.getTime(),
          error: message(error),
        };
        const definitive = final || permanent(error);
        await this.fail(
          run,
          startedAt,
          steps,
          `Action ${index + 1} (${action.type}) : ${message(error)}`,
          definitive,
        );
        this.logger.warn(
          `Automatisation ${automation.id}, exécution ${run.id} : ${message(error)}`,
        );
        throw permanent(error) ? new UnrecoverableError(message(error)) : error;
      }
    }
    await this.prisma.db.automationRun.update({
      where: { id: run.id },
      data: {
        status: 'succeeded',
        steps: steps as unknown as Prisma.InputJsonValue,
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
        error: null,
      },
    });
  }

  private async context(run: AutomationRun, automation: Automation): Promise<RunContext> {
    const instance = await this.prisma.db.instance.findUniqueOrThrow({
      where: { id: run.instanceId },
    });
    const now = new Date();
    if (!run.submissionId) {
      return {
        instance,
        automation,
        run,
        submission: null,
        data: {
          _instance: instance.name,
          _genere_le: formatDateTime(now, instance.timeZone),
          _date: dayIn(now, instance.timeZone).split('-').reverse().join('/'),
        },
      };
    }
    const submission = await this.prisma.db.submission.findUnique({
      where: { id: run.submissionId },
    });
    if (!submission || submission.deletedAt) {
      throw new HttpException({ error: 'not_found', message: 'Fiche supprimée entre-temps' }, 404);
    }
    const data = await this.reports.mergeData(instance, submission.id);
    return {
      instance,
      automation,
      run,
      submission,
      data: {
        ...data,
        _date: dayIn(now, instance.timeZone).split('-').reverse().join('/'),
        _lien: `${this.env.APP_URL.replace(/\/$/, '')}/${instance.short}/submissions/${submission.id}`,
      },
    };
  }

  /**
   * Effet d'une action. Les effets écrits en base le sont dans la même transaction que
   * l'étape (`record`) : une reprise ne les répète pas.
   */
  private async perform(
    ctx: RunContext,
    action: Action,
    index: number,
    stepOf: (result: Record<string, unknown>) => Step,
    steps: Step[],
  ): Promise<Record<string, unknown>> {
    const { instance, run } = ctx;
    const text = (template: string) => renderText(template, ctx.data);
    const record = async <T>(
      effect: (tx: TransactionClient) => Promise<{ result: Record<string, unknown>; value: T }>,
    ) =>
      this.prisma.transaction(async (tx) => {
        const { result, value } = await effect(tx);
        const next = [...steps];
        next[index] = stepOf(result);
        await tx.automationRun.update({
          where: { id: run.id },
          data: { steps: next as unknown as Prisma.InputJsonValue },
        });
        return { result, value };
      });

    switch (action.type) {
      case 'email': {
        const to = await this.emailsOf(ctx, action.to);
        if (to.length === 0)
          throw new HttpException({ message: 'Aucun destinataire (adresse vide)' }, 422);
        const report =
          action.reportId && ctx.submission
            ? await this.reports.renderSubmission(instance, action.reportId, ctx.submission.id)
            : undefined;
        const { result, value } = await record(async (tx) => {
          const emailId = await this.emails.enqueue(tx, instance, {
            to,
            subject: text(action.subject),
            text: text(action.body),
            ...(ctx.submission
              ? { link: { label: 'Ouvrir la fiche', url: String(ctx.data['_lien']) } }
              : {}),
            attachments: report
              ? [{ key: report.key, filename: report.filename, contentType: 'application/pdf' }]
              : [],
            automationRunId: run.id,
            step: index,
          });
          return { result: { emailId, to }, value: emailId };
        });
        await this.emails.dispatch(instance.id, [value]);
        return result;
      }
      case 'notify': {
        const users = await this.usersOf(ctx, action.to);
        const { result, value } = await record(async (tx) => {
          const ids = await this.notifications.notify(tx, instance.id, users, null, {
            type: 'automation',
            title: text(action.title),
            ...(action.body ? { body: text(action.body) } : {}),
            data: ctx.submission
              ? { submissionId: ctx.submission.id, structureId: ctx.submission.structureId }
              : {},
          });
          return { result: { recipients: ids.length }, value: ids };
        });
        await this.notifications.dispatch(instance.id, value);
        return result;
      }
      case 'webhook': {
        const webhook = await this.webhooks.find(action.webhookId);
        const payload = ctx.submission
          ? submissionPayload(ctx.submission, {
              id: ctx.submission.structureId,
              name: String(ctx.data['_formulaire'] ?? ''),
            })
          : {};
        const { result, value } = await record(async (tx) => {
          const ids = await this.webhooks.deliver(
            tx,
            instance.id,
            webhook.id,
            'automation.triggered',
            { automation: { id: ctx.automation.id, name: ctx.automation.name }, ...payload },
            { automationRunId: run.id, step: index },
          );
          return { result: { deliveryId: ids[0] }, value: ids };
        });
        await this.webhooks.dispatch(instance.id, value);
        return result;
      }
      case 'create_task':
        return this.createTask(ctx, action, index);
      case 'update_field': {
        const updated = await this.submissions.update(instance, ctx.submission!.id, SYSTEM_ACTOR, {
          data: { [action.field]: action.value ?? null },
          clientMutationId: `automation:${run.id}:${index}`,
          automationRunId: run.id,
        });
        return { revision: updated.submission.revision };
      }
    }
  }

  private async createTask(
    ctx: RunContext,
    action: Extract<Action, { type: 'create_task' }>,
    index: number,
  ) {
    const { instance, submission } = ctx;
    const structureId =
      action.structureId ?? submission?.structureId ?? ctx.automation.structureId!;
    const day = addDays(dayIn(new Date(), instance.timeZone), action.startInDays);
    const startAt = zonedTime(day, action.startTime, instance.timeZone);
    const assignee =
      action.assignee.type === 'author'
        ? { assigneeUserId: submission?.authorId ?? null }
        : action.assignee.type === 'user'
          ? { assigneeUserId: action.assignee.userId }
          : action.assignee.type === 'group'
            ? { assigneeGroupId: action.assignee.groupId }
            : {};
    const id = stableUuid(ctx.run.id, String(index));
    const existing = await this.prisma.db.task.findUnique({ where: { id } });
    if (existing) return { taskId: id };
    const task = await this.tasks.create(instance, SYSTEM_ACTOR, {
      id,
      structureId,
      title: renderText(action.title, ctx.data),
      ...(action.description ? { description: renderText(action.description, ctx.data) } : {}),
      startAt,
      endAt: new Date(startAt.getTime() + action.durationMinutes * 60_000),
      ...assignee,
      prefill:
        action.copyFields && submission ? await this.copiedFields(submission, structureId) : {},
    });
    return { taskId: task.id };
  }

  /** Champs de la fiche reportés dans la nouvelle : même clé, même type, non calculés. */
  private async copiedFields(submission: Submission, structureId: string): Promise<SubmissionData> {
    const [source, target] = await Promise.all([
      this.prisma.db.structureVersion.findUniqueOrThrow({
        where: { id: submission.structureVersionId },
      }),
      this.prisma.db.structureVersion.findFirst({ where: { structureId, status: 'PUBLISHED' } }),
    ]);
    if (!target) return {};
    const sourceFields = new Map(
      rootValueFields((source.definition as StructureDefinition).fields).map((f) => [
        f.key,
        f.type,
      ]),
    );
    const data = submission.data as SubmissionData;
    const prefill: SubmissionData = {};
    for (const field of rootValueFields((target.definition as StructureDefinition).fields)) {
      if (COMPUTED_TYPES.has(field.type) || field.type === 'table') continue;
      const value = data[field.key];
      if (sourceFields.get(field.key) === field.type && value !== null && value !== undefined) {
        prefill[field.key] = value;
      }
    }
    return prefill;
  }

  private async emailsOf(ctx: RunContext, recipients: Recipient[]): Promise<string[]> {
    const addresses = new Set<string>();
    const userIds = new Set<string>();
    for (const r of recipients) {
      if (r.type === 'address') addresses.add(r.email.toLowerCase());
      if (r.type === 'field') {
        const value = ctx.submission ? (ctx.submission.data as SubmissionData)[r.field] : undefined;
        if (typeof value === 'string' && value.includes('@'))
          addresses.add(value.trim().toLowerCase());
      }
    }
    for (const id of await this.usersOf(ctx, recipients)) userIds.add(id);
    if (userIds.size > 0) {
      const users = await this.prisma.db.user.findMany({
        where: { id: { in: [...userIds] }, isActive: true },
        select: { email: true },
      });
      for (const user of users) addresses.add(user.email);
    }
    return [...addresses];
  }

  /** Utilisateurs membres de l'instance désignés par les destinataires (auteur, groupe…). */
  private async usersOf(ctx: RunContext, recipients: Recipient[]): Promise<string[]> {
    const ids = new Set<string>();
    const groups: string[] = [];
    for (const r of recipients) {
      if (r.type === 'author' && ctx.submission?.authorId) ids.add(ctx.submission.authorId);
      if (r.type === 'user') ids.add(r.userId);
      if (r.type === 'group') groups.push(r.groupId);
    }
    if (groups.length > 0) {
      const members = await this.prisma.db.groupMember.findMany({
        where: { groupId: { in: groups } },
        select: { userId: true },
      });
      for (const m of members) ids.add(m.userId);
    }
    if (ids.size === 0) return [];
    const memberships = await this.prisma.db.membership.findMany({
      where: { userId: { in: [...ids] } },
      select: { userId: true },
    });
    return memberships.map((m) => m.userId);
  }

  private saveSteps(runId: string, steps: Step[]) {
    return this.prisma.db.automationRun.update({
      where: { id: runId },
      data: { steps: steps as unknown as Prisma.InputJsonValue },
    });
  }

  private async fail(
    run: AutomationRun,
    startedAt: Date,
    steps: Step[],
    error: string,
    definitive: boolean,
  ) {
    await this.prisma.db.automationRun.update({
      where: { id: run.id },
      data: {
        // Non définitif : la file réessaiera (l'erreur reste visible en attendant).
        status: definitive ? 'failed' : 'queued',
        steps: steps as unknown as Prisma.InputJsonValue,
        error,
        ...(definitive
          ? { finishedAt: new Date(), durationMs: Date.now() - startedAt.getTime() }
          : {}),
      },
    });
  }

  private finish(run: AutomationRun, status: 'skipped', error: string) {
    return this.prisma.db.automationRun.update({
      where: { id: run.id },
      data: { status, error, finishedAt: new Date() },
    });
  }
}
