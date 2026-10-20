import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { type StructureDefinition } from '@wasafili/form-schema';
import { type Actor } from '../auth/decorators';
import { pageArgs, type Pagination, toPage } from '../common/pagination';
import { type Automation, type Instance, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AutomationQueue } from '../queue/queue.module';
import { type AutomationInput, checkAutomation, type References } from './automation-schema';

const NOT_FOUND = { error: 'not_found', message: 'Automatisation introuvable' };

export interface ListRunsInput extends Pagination {
  automation_id?: string;
  status?: string;
  submission_id?: string;
}

/** Automatisations (P5.3) : configuration, planification, journal d'exécution. */
@Injectable()
export class AutomationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: AutomationQueue,
  ) {}

  async list(structureId?: string) {
    const automations = await this.prisma.db.automation.findMany({
      where: { deletedAt: null, ...(structureId ? { structureId } : {}) },
      orderBy: { name: 'asc' },
    });
    const last = await this.prisma.db.automationRun.findMany({
      where: { automationId: { in: automations.map((a) => a.id) } },
      orderBy: { createdAt: 'desc' },
      distinct: ['automationId'],
      select: { automationId: true, status: true, createdAt: true },
    });
    const byAutomation = new Map(last.map((run) => [run.automationId, run]));
    return {
      data: automations.map((a) => ({
        ...this.toDto(a),
        lastRun: byAutomation.get(a.id)
          ? { status: byAutomation.get(a.id)!.status, createdAt: byAutomation.get(a.id)!.createdAt }
          : null,
      })),
    };
  }

  async get(id: string) {
    return this.toDto(await this.find(id));
  }

  async create(instance: Instance, actor: Actor, input: AutomationInput) {
    await this.validate(input);
    const automation = await this.prisma.db.automation.create({
      data: { instanceId: instance.id, createdById: actor.userId, ...this.columns(input) },
    });
    await this.syncSchedule(instance, automation);
    return this.toDto(automation);
  }

  /** Remplacement complet de la configuration (éditeur du back-office). */
  async update(instance: Instance, id: string, input: AutomationInput) {
    await this.find(id);
    await this.validate(input);
    const automation = await this.prisma.db.automation.update({
      where: { id },
      data: this.columns(input),
    });
    await this.syncSchedule(instance, automation);
    return this.toDto(automation);
  }

  /** Suppression logique : le journal des exécutions reste consultable. */
  async remove(id: string) {
    await this.find(id);
    await this.prisma.db.automation.update({
      where: { id },
      data: { deletedAt: new Date(), enabled: false },
    });
    await this.queue.unschedule(id);
  }

  async runs(input: ListRunsInput) {
    const where: Prisma.AutomationRunWhereInput = {
      ...(input.automation_id ? { automationId: input.automation_id } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.submission_id ? { submissionId: input.submission_id } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.automationRun.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...pageArgs(input),
        include: { automation: { select: { name: true } } },
      }),
      this.prisma.db.automationRun.count({ where }),
    ]);
    return toPage(
      rows.map(({ automation, ...run }) => ({ ...run, automationName: automation.name })),
      total,
      input,
    );
  }

  /** Relance manuelle d'une exécution en échec : seules les actions non faites sont rejouées. */
  async retry(id: string) {
    const run = await this.prisma.db.automationRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException({ error: 'not_found', message: 'Exécution introuvable' });
    if (run.status !== 'failed') {
      throw new ConflictException({
        error: 'conflict',
        message: 'Seule une exécution en échec peut être relancée',
      });
    }
    const updated = await this.prisma.db.automationRun.update({
      where: { id },
      data: { status: 'queued', finishedAt: null, durationMs: null },
    });
    await this.queue.run(run.instanceId, id, `run-${id}-retry-${run.attempts}`);
    return updated;
  }

  /** Planifie (ou retire) le déclencheur cron d'une automatisation. */
  private async syncSchedule(instance: Instance, automation: Automation) {
    const trigger = automation.trigger as { type: string; cron?: string };
    if (trigger.type === 'schedule' && automation.enabled && !automation.deletedAt) {
      try {
        await this.queue.schedule(instance.id, automation.id, trigger.cron!, instance.timeZone);
      } catch (error) {
        await this.prisma.db.automation.update({
          where: { id: automation.id },
          data: { enabled: false },
        });
        throw new UnprocessableEntityException({
          error: 'validation_failed',
          message: `Expression cron invalide : ${(error as Error).message}`,
        });
      }
    } else {
      await this.queue.unschedule(automation.id);
    }
  }

  private async validate(input: AutomationInput) {
    const ids = <T>(list: T[], pick: (item: T) => string | undefined) =>
      list.map(pick).filter((id): id is string => !!id);
    const taskStructures = ids(input.actions, (a) =>
      a.type === 'create_task' ? a.structureId : undefined,
    );
    const structureIds = [
      ...new Set([...(input.structureId ? [input.structureId] : []), ...taskStructures]),
    ];
    const [versions, structures, reports, webhooks, members, groups] = await Promise.all([
      this.prisma.db.structureVersion.findMany({
        where: { structureId: { in: structureIds }, status: 'PUBLISHED' },
        select: { structureId: true, definition: true },
      }),
      this.prisma.db.structure.findMany({
        where: { id: { in: structureIds }, archivedAt: null },
        select: { id: true },
      }),
      input.structureId
        ? this.prisma.db.reportTemplate.findMany({
            where: { structureId: input.structureId },
            select: { id: true },
          })
        : [],
      this.prisma.db.webhook.findMany({ where: { deletedAt: null }, select: { id: true } }),
      this.prisma.db.membership.findMany({ select: { userId: true } }),
      this.prisma.db.group.findMany({ select: { id: true } }),
    ]);
    if (input.structureId && !structures.some((s) => s.id === input.structureId)) {
      throw new NotFoundException({ error: 'not_found', message: 'Structure introuvable' });
    }
    const definitions = new Map(
      versions.map((v) => [v.structureId, v.definition as StructureDefinition]),
    );
    const refs: References = {
      definition: input.structureId ? definitions.get(input.structureId) : undefined,
      reports: new Set(reports.map((r) => r.id)),
      webhooks: new Set(webhooks.map((w) => w.id)),
      users: new Set(members.map((m) => m.userId)),
      groups: new Set(groups.map((g) => g.id)),
      structures: new Map(structures.map((s) => [s.id, definitions.get(s.id)])),
    };
    const problems = checkAutomation(input, refs);
    if (problems.length > 0) {
      throw new UnprocessableEntityException({
        error: 'invalid_automation',
        message: problems.map((p) => p.message).join(' ; '),
        details: problems,
      });
    }
  }

  private columns(input: AutomationInput) {
    return {
      name: input.name,
      enabled: input.enabled,
      structureId: input.structureId ?? null,
      trigger: input.trigger as Prisma.InputJsonValue,
      conditions: input.conditions ? (input.conditions as Prisma.InputJsonValue) : Prisma.DbNull,
      actions: input.actions as unknown as Prisma.InputJsonValue,
    };
  }

  private async find(id: string) {
    const automation = await this.prisma.db.automation.findFirst({
      where: { id, deletedAt: null },
    });
    if (!automation) throw new NotFoundException(NOT_FOUND);
    return automation;
  }

  private toDto(automation: Automation) {
    return {
      id: automation.id,
      name: automation.name,
      enabled: automation.enabled,
      structureId: automation.structureId,
      trigger: automation.trigger,
      conditions: automation.conditions,
      actions: automation.actions,
      createdAt: automation.createdAt,
      updatedAt: automation.updatedAt,
    };
  }
}
