import { Injectable } from '@nestjs/common';
import { evaluate, type EvaluationContext, type FormEngine, truthy } from '@tesserax/form-engine';
import { type JsonLogic } from '@tesserax/form-schema';
import {
  type Automation,
  type Instance,
  type Prisma,
  type Submission,
} from '../generated/prisma/client';
import { type TransactionClient } from '../prisma/tenant';
import { AutomationQueue } from '../queue/queue.module';
import { type FieldChange } from '../submissions/diff';
import { WebhooksService, type WebhookEvent } from '../webhooks/webhooks.service';

/** Pseudo-champ de l'historique pour un changement d'état. */
const STATE_CHANGE = '$state';

/** Longueur maximale d'une chaîne d'automatisations (A modifie → B se déclenche → …). */
export const MAX_AUTOMATION_DEPTH = 3;

export interface SubmissionEvent {
  type: 'created' | 'updated' | 'transition' | 'deleted';
  /** Fiche après l'écriture. */
  submission: Submission;
  revisionId: string;
  revision: number;
  changes: FieldChange[];
  /** Exécution d'automatisation à l'origine de l'écriture (anti-boucle). */
  automationRunId?: string | null;
  /** Moteur de la version de la fiche, pour évaluer les conditions. */
  engine?: FormEngine;
  context?: EvaluationContext;
}

/** Travaux à publier une fois la transaction validée. */
export interface Outbox {
  runs: string[];
  deliveries: string[];
}

export const EMPTY_OUTBOX: Outbox = { runs: [], deliveries: [] };

interface Trigger {
  type: string;
  to?: string[];
  fields?: string[];
}

export function submissionPayload(
  submission: Submission,
  structure: { id: string; name: string },
  changes?: FieldChange[],
) {
  return {
    structure,
    submission: {
      id: submission.id,
      structureId: submission.structureId,
      state: submission.state,
      revision: submission.revision,
      authorId: submission.authorId,
      data: submission.data,
      createdAt: submission.createdAt,
      updatedAt: submission.updatedAt,
      deletedAt: submission.deletedAt,
    },
    ...(changes ? { changes } : {}),
  };
}

/** Le déclencheur correspond-il à l'événement ? */
export function matches(
  trigger: Trigger,
  event: Pick<SubmissionEvent, 'type' | 'changes'>,
): boolean {
  const state = event.changes.find((c) => c.field === STATE_CHANGE);
  switch (trigger.type) {
    case 'submission_created':
      return event.type === 'created';
    case 'state_changed':
      return (
        event.type !== 'deleted' &&
        state !== undefined &&
        (!trigger.to?.length || trigger.to.includes(String(state.after)))
      );
    case 'field_changed':
      return (
        (event.type === 'updated' || event.type === 'transition') &&
        event.changes.some((c) => trigger.fields?.includes(c.field))
      );
    default:
      return false;
  }
}

/**
 * Événements de fiche (ADR 0009) : chaque écriture produit, dans sa transaction, les
 * livraisons de webhooks et les exécutions d'automatisations qui en découlent. Rien n'est
 * perdu si la publication échoue ensuite : les lignes restent `queued`/`pending`.
 */
@Injectable()
export class EventsService {
  constructor(
    private readonly webhooks: WebhooksService,
    private readonly queue: AutomationQueue,
  ) {}

  async record(tx: TransactionClient, instance: Instance, event: SubmissionEvent): Promise<Outbox> {
    const { submission } = event;
    const structure = await tx.structure.findUniqueOrThrow({
      where: { id: submission.structureId },
      select: { id: true, name: true },
    });
    const payload = submissionPayload(submission, structure, event.changes);
    const state = event.changes.some((c) => c.field === STATE_CHANGE);
    const events: WebhookEvent[] =
      event.type === 'created'
        ? ['submission.created']
        : event.type === 'deleted'
          ? ['submission.deleted']
          : ['submission.updated', ...(state ? (['submission.state_changed'] as const) : [])];
    const deliveries: string[] = [];
    for (const name of events) {
      deliveries.push(...(await this.webhooks.emit(tx, instance.id, name, structure.id, payload)));
    }
    if (event.type === 'deleted') return { runs: [], deliveries };
    return { runs: await this.automationRuns(tx, instance, event), deliveries };
  }

  private async automationRuns(tx: TransactionClient, instance: Instance, event: SubmissionEvent) {
    const automations = (
      await tx.automation.findMany({
        where: { structureId: event.submission.structureId, enabled: true, deletedAt: null },
      })
    ).filter((a) => matches(a.trigger as unknown as Trigger, event));
    if (automations.length === 0) return [];

    const source = event.automationRunId
      ? await tx.automationRun.findUnique({
          where: { id: event.automationRunId },
          select: { automationId: true, depth: true },
        })
      : null;
    const state = event.changes.find((c) => c.field === STATE_CHANGE);
    const description = {
      type: event.type,
      revision: event.revision,
      ...(state ? { from: state.before, to: state.after } : {}),
      fields: event.changes.map((c) => c.field).filter((f) => f !== STATE_CHANGE),
    };

    const runs: string[] = [];
    for (const automation of automations) {
      // Une automatisation ne se redéclenche jamais sur sa propre écriture.
      if (source?.automationId === automation.id) continue;
      if (!this.conditionsMet(automation, event)) continue;
      const depth = source ? source.depth + 1 : 0;
      const tooDeep = depth > MAX_AUTOMATION_DEPTH;
      const run = await tx.automationRun.create({
        data: {
          instanceId: instance.id,
          automationId: automation.id,
          submissionId: event.submission.id,
          eventKey: `revision:${event.revisionId}`,
          event: description as Prisma.InputJsonValue,
          depth,
          ...(tooDeep
            ? {
                status: 'skipped',
                error: `Chaîne de ${depth} automatisations : boucle probable, exécution ignorée`,
                finishedAt: new Date(),
              }
            : {}),
        },
        select: { id: true },
      });
      if (!tooDeep) runs.push(run.id);
    }
    return runs;
  }

  private conditionsMet(automation: Automation, event: SubmissionEvent): boolean {
    if (!automation.conditions) return true;
    const environment = event.engine?.environment({
      ...event.context,
      state: event.submission.state,
    }) ?? {
      $state: event.submission.state,
    };
    const data = { ...(event.submission.data as Record<string, unknown>), ...environment };
    return truthy(evaluate(automation.conditions as JsonLogic, data));
  }

  async dispatch(instanceId: string, outbox: Outbox) {
    for (const runId of outbox.runs) await this.queue.run(instanceId, runId);
    await this.webhooks.dispatch(instanceId, outbox.deliveries);
  }
}
