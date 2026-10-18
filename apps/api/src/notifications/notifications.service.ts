import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { type Actor } from '../auth/decorators';
import { pageArgs, type Pagination, toPage } from '../common/pagination';
import { ENV, type Env } from '../config/env';
import { type Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { type TransactionClient } from '../prisma/tenant';
import { JobQueue } from '../queue/queue.module';

export interface NotificationInput {
  type: 'task_assigned' | 'submission_state' | 'automation';
  title: string;
  body?: string;
  data: Record<string, string>;
}

/**
 * Notifications (P4.5, D1). Elles sont écrites dans la transaction de l'événement qui les
 * produit et arrivent sur le mobile par la synchronisation ; le push Expo n'est qu'un relais,
 * envoyé après validation de la transaction et désactivable (`PUSH_ENABLED`).
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: JobQueue,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Crée une notification par destinataire (l'auteur de l'action exclu) ; renvoie les ids. */
  async notify(
    tx: TransactionClient,
    instanceId: string,
    recipients: readonly (string | null | undefined)[],
    actorId: string | null,
    input: NotificationInput,
  ): Promise<string[]> {
    const users = [...new Set(recipients)].filter(
      (id): id is string => typeof id === 'string' && id !== actorId,
    );
    const ids: string[] = [];
    for (const userId of users) {
      const created = await tx.notification.create({
        data: {
          instanceId,
          userId,
          type: input.type,
          title: input.title,
          body: input.body ?? null,
          data: input.data as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      ids.push(created.id);
    }
    return ids;
  }

  /** Relais push, à appeler une fois la transaction validée. */
  async dispatch(instanceId: string, notificationIds: string[]): Promise<void> {
    if (!this.env.PUSH_ENABLED || notificationIds.length === 0) return;
    await this.queue.add('push', { instanceId, notificationIds });
  }

  async list(actor: Actor, input: Pagination & { unread?: boolean }) {
    const userId = this.user(actor);
    const where = { userId, ...(input.unread ? { readAt: null } : {}) };
    const [data, total, unread] = await Promise.all([
      this.prisma.db.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...pageArgs(input),
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          data: true,
          readAt: true,
          createdAt: true,
        },
      }),
      this.prisma.db.notification.count({ where }),
      this.prisma.db.notification.count({ where: { userId, readAt: null } }),
    ]);
    const page = toPage(data, total, input);
    return { ...page, meta: { ...page.meta, unread } };
  }

  /** Marque comme lues les notifications données (toutes sans liste). */
  async markRead(actor: Actor, ids?: string[]) {
    const userId = this.user(actor);
    const { count } = await this.prisma.db.notification.updateMany({
      where: { userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
      data: { readAt: new Date() },
    });
    return { updated: count };
  }

  /** Enregistre le jeton push d'un appareil ; un appareil passé à un autre compte suit le compte. */
  async registerToken(instanceId: string, actor: Actor, token: string, platform?: string) {
    const userId = this.user(actor);
    await this.prisma.db.pushToken.upsert({
      where: { instanceId_token: { instanceId, token } },
      create: { instanceId, userId, token, platform: platform ?? null },
      update: { userId, platform: platform ?? null },
    });
  }

  /** Désactive le push pour un appareil (préférence de l'utilisateur ou déconnexion). */
  async unregisterToken(actor: Actor, token: string) {
    const userId = this.user(actor);
    await this.prisma.db.pushToken.deleteMany({ where: { userId, token } });
  }

  private user(actor: Actor): string {
    if (!actor.userId) {
      throw new ForbiddenException({
        error: 'forbidden',
        message: 'Réservé aux utilisateurs',
      });
    }
    return actor.userId;
  }
}
