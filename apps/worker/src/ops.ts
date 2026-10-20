import { createServer, type Server } from 'node:http';
import { type Job, type Queue } from 'bullmq';
import { Counter, collectDefaultMetrics, Gauge, Histogram, Registry } from 'prom-client';

const QUEUE_STATES = ['waiting', 'active', 'delayed', 'failed'] as const;

/** Métriques Prometheus du worker (P7.2.2) : processus, jobs traités, files d'attente. */
export function workerMetrics(queues: Queue[]) {
  const registry = new Registry();
  registry.setDefaultLabels({ service: 'worker' });
  collectDefaultMetrics({ register: registry });
  const jobs = new Counter({
    name: 'wasafili_jobs_total',
    help: 'Jobs traités, par type et issue (completed, failed).',
    labelNames: ['name', 'status'] as const,
    registers: [registry],
  });
  const duration = new Histogram({
    name: 'wasafili_job_duration_seconds',
    help: 'Durée de traitement des jobs, par type.',
    labelNames: ['name'] as const,
    buckets: [0.05, 0.1, 0.5, 1, 2, 5, 10, 30, 60, 300],
    registers: [registry],
  });
  new Gauge({
    name: 'wasafili_queue_jobs',
    help: 'Jobs en file, par file et état.',
    labelNames: ['queue', 'state'] as const,
    registers: [registry],
    async collect() {
      for (const queue of queues) {
        const counts = await queue.getJobCounts(...QUEUE_STATES);
        for (const state of QUEUE_STATES) {
          this.set({ queue: queue.name, state }, counts[state] ?? 0);
        }
      }
    },
  });
  return {
    registry,
    /** À brancher sur les événements `completed` et `failed` du worker BullMQ. */
    record(job: Job | undefined, status: 'completed' | 'failed') {
      if (!job) return;
      jobs.inc({ name: job.name, status });
      if (job.processedOn && job.finishedOn) {
        duration.observe({ name: job.name }, (job.finishedOn - job.processedOn) / 1000);
      }
    },
  };
}

export interface OpsOptions {
  port: number;
  registry: Registry;
  /** Sondes des dépendances ; une sonde qui lève une erreur est « down ». */
  checks: Record<string, () => Promise<unknown>>;
}

/**
 * Point d'exploitation interne du worker : `/health` (Redis, PostgreSQL ; 200 ou 503) et
 * `/metrics` (format Prometheus). Non publié hors du réseau Docker.
 */
export function startOpsServer({ port, registry, checks }: OpsOptions): Server {
  const server = createServer((req, res) => {
    void (async () => {
      if (req.url === '/health') {
        const results = await Promise.all(
          Object.entries(checks).map(async ([name, check]) => {
            try {
              await check();
              return [name, 'up'] as const;
            } catch {
              return [name, 'down'] as const;
            }
          }),
        );
        const healthy = results.every(([, state]) => state === 'up');
        res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ status: healthy ? 'ok' : 'error', checks: Object.fromEntries(results) }),
        );
      } else if (req.url === '/metrics') {
        res.writeHead(200, { 'Content-Type': registry.contentType });
        res.end(await registry.metrics());
      } else {
        res.writeHead(404).end();
      }
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  return server.listen(port);
}
