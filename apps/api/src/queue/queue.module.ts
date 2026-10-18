import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import {
  AUTOMATION_QUEUE_NAME,
  type AutomationJob,
  EMAIL_ATTEMPTS,
  EMAIL_BACKOFF_MS,
  type JobName,
  type JobPayloads,
  QUEUE_NAME,
  WEBHOOK_ATTEMPTS,
  WEBHOOK_BACKOFF_MS,
} from '@tesserax/jobs';
import { Queue } from 'bullmq';
import { ENV, type Env } from '../config/env';

/** Tentatives par type de job (défaut : 5, backoff exponentiel depuis 2 s). */
const RETRIES: Partial<Record<JobName, { attempts: number; delay: number }>> = {
  email: { attempts: EMAIL_ATTEMPTS, delay: EMAIL_BACKOFF_MS },
  webhook: { attempts: WEBHOOK_ATTEMPTS, delay: WEBHOOK_BACKOFF_MS },
};

/** Publication de jobs vers le worker. */
export class JobQueue {
  constructor(private readonly queue: Queue) {}

  add<N extends JobName>(name: N, payload: JobPayloads[N], jobId?: string) {
    const retries = RETRIES[name] ?? { attempts: 5, delay: 2_000 };
    return this.queue.add(name, payload, {
      ...(jobId ? { jobId } : {}),
      attempts: retries.attempts,
      backoff: { type: 'exponential', delay: retries.delay },
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
    });
  }

  close() {
    return this.queue.close();
  }
}

/** File des exécutions d'automatisations (consommée par l'API, ADR 0009). */
export class AutomationQueue {
  constructor(readonly queue: Queue<AutomationJob>) {}

  run(instanceId: string, runId: string, jobId = `run-${runId}`) {
    return this.queue.add(
      'run',
      { kind: 'run', instanceId, runId },
      {
        jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: 1_000,
        removeOnFail: 5_000,
      },
    );
  }

  /** Déclencheur planifié : un job par échéance du cron, dans le fuseau de l'instance. */
  schedule(instanceId: string, automationId: string, cron: string, timeZone: string) {
    return this.queue.upsertJobScheduler(
      `automation-${automationId}`,
      { pattern: cron, tz: timeZone },
      {
        name: 'schedule',
        data: { kind: 'schedule', instanceId, automationId },
        opts: { removeOnComplete: 100, removeOnFail: 1_000 },
      },
    );
  }

  unschedule(automationId: string) {
    return this.queue.removeJobScheduler(`automation-${automationId}`);
  }

  close() {
    return this.queue.close();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: JobQueue,
      inject: [ENV],
      useFactory: (env: Env) =>
        new JobQueue(
          new Queue(QUEUE_NAME, { connection: { url: env.REDIS_URL }, prefix: env.QUEUE_PREFIX }),
        ),
    },
    {
      provide: AutomationQueue,
      inject: [ENV],
      useFactory: (env: Env) =>
        new AutomationQueue(
          new Queue(AUTOMATION_QUEUE_NAME, {
            connection: { url: env.REDIS_URL },
            prefix: env.QUEUE_PREFIX,
          }),
        ),
    },
  ],
  exports: [JobQueue, AutomationQueue],
})
export class QueueModule implements OnModuleDestroy {
  constructor(
    @Inject(JobQueue) private readonly queue: JobQueue,
    @Inject(AutomationQueue) private readonly automations: AutomationQueue,
  ) {}

  async onModuleDestroy() {
    await Promise.all([this.queue.close(), this.automations.close()]);
  }
}
