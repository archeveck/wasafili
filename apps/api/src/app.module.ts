import { Module } from '@nestjs/common';
import { type Request } from 'express';
import { randomUUID } from 'node:crypto';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ApiClientsModule } from './api-clients/api-clients.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AutomationsModule } from './automations/automations.module';
import { DashboardsModule } from './dashboards/dashboards.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { AllExceptionsFilter } from './common/errors';
import { FieldsInterceptor } from './common/fields';
import { ConfigModule } from './config/config.module';
import { ENV, type Env } from './config/env';
import { FilesModule } from './files/files.module';
import { HealthModule } from './health/health.module';
import { IamModule } from './iam/iam.module';
import { ListsModule } from './lists/lists.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OpenApiModule } from './openapi/openapi.module';
import { PhotoExportsModule } from './photo-exports/photo-exports.module';
import { PrismaModule } from './prisma/prisma.module';
import { RateLimitGuard } from './rate-limit/rate-limit.guard';
import { RateLimitModule } from './rate-limit/rate-limit.module';
import { QueueModule } from './queue/queue.module';
import { RedisModule } from './redis/redis.module';
import { ReportsModule } from './reports/reports.module';
import { EmailsModule } from './emails/emails.module';
import { EventsModule } from './events/events.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { SettingsModule } from './settings/settings.module';
import { StructuresModule } from './structures/structures.module';
import { SubmissionsModule } from './submissions/submissions.module';
import { TasksModule } from './tasks/tasks.module';
import { TeamModule } from './team/team.module';
import { InstanceGuard } from './tenancy/instance.guard';
import { PermissionGuard } from './tenancy/permission.guard';

/** Identifiant de requête accepté depuis le proxy : court, sans caractère de contrôle. */
const REQUEST_ID = /^[\w.-]{1,100}$/;

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        // Journaux JSON (P7.2.2) : un identifiant par requête, repris de `X-Request-Id` (proxy)
        // ou généré, renvoyé au client et présent sur chaque ligne ; appelant et instance.
        pinoHttp: {
          level: env.LOG_LEVEL,
          base: { service: 'api' },
          redact: ['req.headers.authorization', 'req.headers.cookie'],
          genReqId: (req, res) => {
            const given = req.headers['x-request-id'];
            const id = typeof given === 'string' && REQUEST_ID.test(given) ? given : randomUUID();
            res.setHeader('X-Request-Id', id);
            return id;
          },
          customProps: (req) => {
            const { principal, instance } = req as Request;
            return {
              ...(principal?.kind === 'user' ? { userId: principal.userId } : {}),
              ...(principal?.kind === 'client' ? { clientId: principal.clientId } : {}),
              ...(instance ? { app: instance.short } : {}),
            };
          },
          autoLogging: {
            ignore: (req) => /^\/(health|metrics)(\/|$)/.test(req.url ?? ''),
          },
        },
      }),
    }),
    PrismaModule,
    RedisModule,
    RateLimitModule,
    HealthModule,
    OpenApiModule,
    AuditModule,
    AuthModule,
    IamModule,
    ApiClientsModule,
    StructuresModule,
    SubmissionsModule,
    ListsModule,
    QueueModule,
    FilesModule,
    SettingsModule,
    NotificationsModule,
    TasksModule,
    WebhooksModule,
    EmailsModule,
    EventsModule,
    ReportsModule,
    AutomationsModule,
    TeamModule,
    DashboardsModule,
    PhotoExportsModule,
  ],
  providers: [
    // Ordre significatif : authentification → instance (contexte RLS) → débit → permissions.
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_GUARD, useClass: InstanceGuard },
    { provide: APP_GUARD, useExisting: RateLimitGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_INTERCEPTOR, useClass: FieldsInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
