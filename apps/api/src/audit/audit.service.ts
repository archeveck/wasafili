import { Injectable, Logger } from '@nestjs/common';
import { pageArgs, type Pagination, toPage } from '../common/pagination';
import { runWithContext } from '../common/request-context';
import { type Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Actions tracées (P6.3.1). Le libellé affiché vit dans `@tesserax/i18n` (`audit.actions`). */
export const AUDIT_ACTIONS = [
  'auth.login',
  'auth.login_failed',
  'auth.client_token',
  'auth.client_token_failed',
  'user.create',
  'user.update',
  'user.remove',
  'role.create',
  'role.update',
  'role.delete',
  'group.create',
  'group.update',
  'group.delete',
  'group.members',
  'settings.update',
  'structure.create',
  'structure.update',
  'structure.delete',
  'structure.publish',
  'structure.access',
  'list.create',
  'list.update',
  'list.delete',
  'list.import',
  'report.create',
  'report.update',
  'report.delete',
  'report.render',
  'automation.create',
  'automation.update',
  'automation.delete',
  'automation_run.retry',
  'webhook.create',
  'webhook.update',
  'webhook.delete',
  'webhook.secret',
  'webhook_delivery.retry',
  'email.retry',
  'dashboard.create',
  'dashboard.update',
  'dashboard.delete',
  'submission.export',
  'submission.photos_export',
  'photo_export.download',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEntry {
  instanceId: string;
  action: AuditAction;
  actorUserId?: string | null;
  actorClientId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  targetLabel?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

export interface AuditQuery extends Pagination {
  action?: string;
  actor_id?: string;
  target_id?: string;
  from?: Date;
  to?: Date;
}

const SECRET_KEY = /password|secret|token|authorization/i;
const MAX_STRING = 500;
const MAX_METADATA = 8_000;

/**
 * Paramètres d'une action tels qu'ils sont journalisés : secrets masqués, chaînes longues
 * tronquées, contenu volumineux (fichier importé, définition de formulaire) résumé.
 */
export function sanitizeMetadata(value: unknown): Record<string, unknown> {
  const clean = (input: unknown, depth: number): unknown => {
    if (typeof input === 'string') {
      return input.length > MAX_STRING ? `${input.slice(0, MAX_STRING)}…` : input;
    }
    if (input === null || typeof input !== 'object') return input;
    if (depth > 6) return '…';
    if (Array.isArray(input)) return input.map((item) => clean(item, depth + 1));
    return Object.fromEntries(
      Object.entries(input).map(([key, item]) => [
        key,
        SECRET_KEY.test(key) ? '[masqué]' : clean(item, depth + 1),
      ]),
    );
  };
  if (value === undefined || value === null || typeof value !== 'object') return {};
  const result = clean(value, 0) as Record<string, unknown>;
  const size = JSON.stringify(result).length;
  return size > MAX_METADATA ? { truncated: true, keys: Object.keys(result), size } : result;
}

/**
 * Journal d'audit (P6.3, ADR 0010). Les entrées sont écrites après le succès de l'action :
 * un échec d'écriture est consigné dans les logs sans annuler une action déjà validée.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await runWithContext({ instanceId: entry.instanceId }, async () => {
        const actorLabel = await this.actorLabel(entry);
        await this.prisma.db.auditLog.create({
          data: {
            instanceId: entry.instanceId,
            action: entry.action,
            actorUserId: entry.actorUserId ?? null,
            actorClientId: entry.actorClientId ?? null,
            actorLabel,
            targetType: entry.targetType ?? null,
            targetId: entry.targetId ?? null,
            targetLabel: entry.targetLabel?.slice(0, MAX_STRING) ?? null,
            metadata: (entry.metadata ?? {}) as Prisma.InputJsonObject,
            ip: entry.ip ?? null,
            userAgent: entry.userAgent?.slice(0, MAX_STRING) ?? null,
          },
        });
      });
    } catch (error) {
      this.logger.error({ err: error, action: entry.action }, 'écriture du journal d’audit');
    }
  }

  /**
   * Action d'un utilisateur hors instance (connexion) : une entrée dans chacune de ses
   * instances, pour que chaque administrateur la voie.
   */
  async recordForUser(
    userId: string,
    entry: Omit<AuditEntry, 'instanceId' | 'actorUserId'>,
  ): Promise<void> {
    const memberships = await runWithContext({ userId }, () =>
      this.prisma.db.membership.findMany({ where: { userId }, select: { instanceId: true } }),
    ).catch((error: unknown) => {
      this.logger.error({ err: error }, 'adhésions pour le journal d’audit');
      return [];
    });
    await Promise.all(
      memberships.map(({ instanceId }) =>
        this.record({ ...entry, instanceId, actorUserId: userId }),
      ),
    );
  }

  async list(query: AuditQuery) {
    const where: Prisma.AuditLogWhereInput = {
      // Action connue : égalité ; sinon préfixe (`role.`, `automation` couvre `automation_run.*`).
      ...(query.action
        ? (AUDIT_ACTIONS as readonly string[]).includes(query.action)
          ? { action: query.action }
          : { action: { startsWith: query.action } }
        : {}),
      ...(query.actor_id ? { actorUserId: query.actor_id } : {}),
      ...(query.target_id ? { targetId: query.target_id } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lt: query.to } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...pageArgs(query),
      }),
      this.prisma.db.auditLog.count({ where }),
    ]);
    return toPage(rows, total, query);
  }

  private async actorLabel(entry: AuditEntry): Promise<string | null> {
    if (entry.actorUserId) {
      const user = await this.prisma.db.user.findUnique({
        where: { id: entry.actorUserId },
        select: { email: true },
      });
      return user?.email ?? null;
    }
    if (entry.actorClientId) {
      const client = await this.prisma.db.oAuthClient.findUnique({
        where: { id: entry.actorClientId },
        select: { name: true },
      });
      return client?.name ?? null;
    }
    return null;
  }
}
