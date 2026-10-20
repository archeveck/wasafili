import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomToken } from '../auth/crypto';
import { type Actor } from '../auth/decorators';
import { pageArgs, type Pagination, toPage } from '../common/pagination';
import { type Prisma, type Webhook } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { type TransactionClient } from '../prisma/tenant';
import { JobQueue } from '../queue/queue.module';

/** Événements auxquels un webhook peut s'abonner (P5.4). */
export const WEBHOOK_EVENTS = [
  'submission.created',
  'submission.updated',
  'submission.state_changed',
  'submission.deleted',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export interface WebhookInput {
  name: string;
  url: string;
  events: WebhookEvent[];
  structureId?: string | null;
}

const NOT_FOUND = { error: 'not_found', message: 'Webhook introuvable' };

/**
 * Webhooks sortants (P5.4). Une livraison est écrite dans la transaction de l'événement et
 * envoyée par le worker (signature HMAC, retentatives, désactivation après échecs répétés).
 */
@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: JobQueue,
  ) {}

  async list() {
    const webhooks = await this.prisma.db.webhook.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return { data: webhooks.map((w) => this.toDto(w)) };
  }

  async get(id: string) {
    return this.toDto(await this.find(id));
  }

  /** Le secret n'est renvoyé qu'ici et à la rotation. */
  async create(instanceId: string, actor: Actor, input: WebhookInput) {
    await this.checkStructure(input.structureId);
    const webhook = await this.prisma.db.webhook.create({
      data: {
        instanceId,
        name: input.name,
        url: input.url,
        events: input.events,
        structureId: input.structureId ?? null,
        secret: `whsec_${randomToken()}`,
        createdById: actor.userId,
      },
    });
    return { ...this.toDto(webhook), secret: webhook.secret };
  }

  /** Réactiver (`enabled: true`) remet le compteur d'échecs à zéro. */
  async update(id: string, input: Partial<WebhookInput> & { enabled?: boolean }) {
    await this.find(id);
    if (input.structureId !== undefined) await this.checkStructure(input.structureId);
    const webhook = await this.prisma.db.webhook.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.url !== undefined ? { url: input.url } : {}),
        ...(input.events !== undefined ? { events: input.events } : {}),
        ...(input.structureId !== undefined ? { structureId: input.structureId } : {}),
        ...(input.enabled === true
          ? { disabledAt: null, disabledReason: null, consecutiveFailures: 0 }
          : input.enabled === false
            ? { disabledAt: new Date(), disabledReason: 'Désactivé manuellement' }
            : {}),
      },
    });
    return this.toDto(webhook);
  }

  async rotateSecret(id: string) {
    await this.find(id);
    const webhook = await this.prisma.db.webhook.update({
      where: { id },
      data: { secret: `whsec_${randomToken()}` },
    });
    return { ...this.toDto(webhook), secret: webhook.secret };
  }

  /** Suppression logique : les livraisons restent consultables, celles en attente sont annulées. */
  async remove(id: string) {
    await this.find(id);
    await this.prisma.db.webhook.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async deliveries(id: string, input: Pagination) {
    await this.find(id);
    const where = { webhookId: id };
    const [rows, total] = await Promise.all([
      this.prisma.db.webhookDelivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...pageArgs(input),
        select: {
          id: true,
          event: true,
          status: true,
          attempts: true,
          responseStatus: true,
          error: true,
          durationMs: true,
          automationRunId: true,
          deliveredAt: true,
          createdAt: true,
        },
      }),
      this.prisma.db.webhookDelivery.count({ where }),
    ]);
    return toPage(rows, total, input);
  }

  /** Événement de test (`ping`), pour vérifier l'URL et la signature côté destinataire. */
  async ping(instanceId: string, id: string) {
    const webhook = await this.find(id);
    const [deliveryId] = await this.prisma.transaction((tx) =>
      this.deliver(tx, instanceId, webhook.id, 'ping', { message: 'Test de webhook Wasafili' }),
    );
    await this.dispatch(instanceId, [deliveryId!]);
    return { deliveryId };
  }

  /** Nouvel essai d'une livraison échouée. */
  async redeliver(instanceId: string, id: string, deliveryId: string) {
    const webhook = await this.find(id);
    if (webhook.disabledAt) {
      throw new ConflictException({
        error: 'webhook_disabled',
        message: 'Réactivez d’abord le webhook',
      });
    }
    const delivery = await this.prisma.db.webhookDelivery.findFirst({
      where: { id: deliveryId, webhookId: id },
    });
    if (!delivery)
      throw new NotFoundException({ error: 'not_found', message: 'Livraison introuvable' });
    if (delivery.status === 'delivered') {
      throw new ConflictException({ error: 'conflict', message: 'Livraison déjà réussie' });
    }
    await this.prisma.db.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: 'pending', error: null },
    });
    await this.queue.add(
      'webhook',
      { instanceId, deliveryId },
      `webhook-${deliveryId}-${delivery.attempts}`,
    );
    return { deliveryId, status: 'pending' };
  }

  /** Livraisons d'un événement de fiche aux webhooks abonnés (dans la transaction). */
  async emit(
    tx: TransactionClient,
    instanceId: string,
    event: WebhookEvent,
    structureId: string,
    payload: Record<string, unknown>,
  ): Promise<string[]> {
    const webhooks = await tx.webhook.findMany({
      where: {
        deletedAt: null,
        disabledAt: null,
        events: { has: event },
        OR: [{ structureId: null }, { structureId }],
      },
      select: { id: true },
    });
    const ids: string[] = [];
    for (const webhook of webhooks) {
      ids.push(...(await this.deliver(tx, instanceId, webhook.id, event, payload)));
    }
    return ids;
  }

  /** Livraison à un webhook donné (action d'automatisation, test). */
  async deliver(
    tx: TransactionClient,
    instanceId: string,
    webhookId: string,
    event: string,
    payload: Record<string, unknown>,
    origin: { automationRunId?: string; step?: number } = {},
  ): Promise<string[]> {
    const delivery = await tx.webhookDelivery.create({
      data: {
        instanceId,
        webhookId,
        event,
        payload: payload as Prisma.InputJsonValue,
        automationRunId: origin.automationRunId ?? null,
        step: origin.step ?? null,
      },
      select: { id: true },
    });
    return [delivery.id];
  }

  async dispatch(instanceId: string, deliveryIds: string[]) {
    for (const deliveryId of deliveryIds) {
      await this.queue.add('webhook', { instanceId, deliveryId }, `webhook-${deliveryId}`);
    }
  }

  private async checkStructure(structureId: string | null | undefined) {
    if (!structureId) return;
    const structure = await this.prisma.db.structure.findUnique({ where: { id: structureId } });
    if (!structure) {
      throw new BadRequestException({ error: 'validation_failed', message: 'Structure inconnue' });
    }
  }

  async find(id: string) {
    const webhook = await this.prisma.db.webhook.findFirst({ where: { id, deletedAt: null } });
    if (!webhook) throw new NotFoundException(NOT_FOUND);
    return webhook;
  }

  private toDto(webhook: Webhook) {
    return {
      id: webhook.id,
      name: webhook.name,
      url: webhook.url,
      events: webhook.events,
      structureId: webhook.structureId,
      enabled: webhook.disabledAt === null,
      disabledAt: webhook.disabledAt,
      disabledReason: webhook.disabledReason,
      consecutiveFailures: webhook.consecutiveFailures,
      secretHint: `…${webhook.secret.slice(-4)}`,
      createdAt: webhook.createdAt,
      updatedAt: webhook.updatedAt,
    };
  }
}
