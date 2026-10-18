import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { type JobName, type JobPayloads, QUEUE_NAME } from '@tesserax/jobs';
import { Queue } from 'bullmq';
import { ENV, type Env } from '../config/env';

/** Publication de jobs vers le worker. */
export class JobQueue {
  constructor(private readonly queue: Queue) {}

  add<N extends JobName>(name: N, payload: JobPayloads[N], jobId?: string) {
    return this.queue.add(name, payload, {
      ...(jobId ? { jobId } : {}),
      attempts: 5,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
    });
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
  ],
  exports: [JobQueue],
})
export class QueueModule implements OnModuleDestroy {
  constructor(@Inject(JobQueue) private readonly queue: JobQueue) {}

  async onModuleDestroy() {
    await this.queue.close();
  }
}
