import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { AUTOMATION_QUEUE_NAME, type AutomationJob } from '@tesserax/jobs';
import { type Job, Worker } from 'bullmq';
import { runWithContext } from '../common/request-context';
import { ENV, type Env } from '../config/env';
import { AutomationRunner } from './automation-runner';

/**
 * Consommateur de la file des automatisations, dans le processus de l'API : les actions ont
 * besoin de ses services métier (droits, validation, historique). Désactivable par instance
 * de l'API (`AUTOMATIONS_WORKER=false`) quand plusieurs répliques tournent.
 */
@Injectable()
export class AutomationsProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutomationsProcessor.name);
  private worker?: Worker<AutomationJob>;

  constructor(
    private readonly runner: AutomationRunner,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit() {
    if (!this.env.AUTOMATIONS_WORKER) return;
    this.worker = new Worker<AutomationJob>(AUTOMATION_QUEUE_NAME, (job) => this.process(job), {
      connection: { url: this.env.REDIS_URL },
      prefix: this.env.QUEUE_PREFIX,
      concurrency: 4,
    });
    this.worker.on('failed', (job, error) =>
      this.logger.warn(`Exécution ${job?.id ?? '?'} en échec : ${error.message}`),
    );
  }

  process(job: Job<AutomationJob>) {
    const data = job.data;
    return runWithContext({ instanceId: data.instanceId }, async () => {
      if (data.kind === 'schedule') {
        await this.runner.scheduled(
          data.instanceId,
          data.automationId,
          job.id ?? String(job.timestamp),
        );
      } else {
        await this.runner.execute(data.runId, job.attemptsMade + 1 >= (job.opts.attempts ?? 1));
      }
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
