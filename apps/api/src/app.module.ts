import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module';
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
import { PrismaModule } from './prisma/prisma.module';
import { QueueModule } from './queue/queue.module';
import { RedisModule } from './redis/redis.module';
import { SettingsModule } from './settings/settings.module';
import { StructuresModule } from './structures/structures.module';
import { SubmissionsModule } from './submissions/submissions.module';
import { TasksModule } from './tasks/tasks.module';
import { InstanceGuard } from './tenancy/instance.guard';
import { PermissionGuard } from './tenancy/permission.guard';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          base: { service: 'api' },
          redact: ['req.headers.authorization', 'req.headers.cookie'],
          autoLogging: { ignore: (req) => req.url === '/health' },
        },
      }),
    }),
    PrismaModule,
    RedisModule,
    HealthModule,
    AuthModule,
    IamModule,
    StructuresModule,
    SubmissionsModule,
    ListsModule,
    QueueModule,
    FilesModule,
    SettingsModule,
    NotificationsModule,
    TasksModule,
  ],
  providers: [
    // Ordre significatif : authentification → instance (contexte RLS) → permissions.
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_GUARD, useClass: InstanceGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_INTERCEPTOR, useClass: FieldsInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
