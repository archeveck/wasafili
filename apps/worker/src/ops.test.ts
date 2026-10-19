import { type AddressInfo } from 'node:net';
import { type Job, type Queue } from 'bullmq';
import { afterEach, describe, expect, it } from 'vitest';
import { startOpsServer, workerMetrics } from './ops.js';

const queue = (name: string, counts: Record<string, number>) =>
  ({ name, getJobCounts: async () => counts }) as unknown as Queue;

describe('point d’exploitation du worker', () => {
  let server: ReturnType<typeof startOpsServer> | undefined;
  afterEach(() => server?.close());

  const start = (checks: Record<string, () => Promise<unknown>>) => {
    const metrics = workerMetrics([
      queue('tesserax', { waiting: 3, active: 1, delayed: 0, failed: 2 }),
    ]);
    server = startOpsServer({ port: 0, registry: metrics.registry, checks });
    const { port } = server.address() as AddressInfo;
    return { metrics, url: (path: string) => `http://127.0.0.1:${port}${path}` };
  };

  it('répond 200 quand les dépendances répondent, 503 sinon', async () => {
    const ok = start({ redis: async () => 'PONG', database: async () => 1 });
    const res = await fetch(ok.url('/health'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', checks: { redis: 'up', database: 'up' } });
    server!.close();

    const down = start({
      redis: async () => 'PONG',
      database: async () => {
        throw new Error('connexion refusée');
      },
    });
    const failed = await fetch(down.url('/health'));
    expect(failed.status).toBe(503);
    const body = (await failed.json()) as { checks: Record<string, string> };
    expect(body.checks['database']).toBe('down');
  });

  it('expose les jobs traités et les files au format Prometheus', async () => {
    const { metrics, url } = start({});
    metrics.record({ name: 'webhook', processedOn: 1_000, finishedOn: 1_500 } as Job, 'completed');
    metrics.record({ name: 'webhook' } as Job, 'failed');
    const text = await (await fetch(url('/metrics'))).text();
    expect(text).toContain(
      'tesserax_jobs_total{name="webhook",status="completed",service="worker"} 1',
    );
    expect(text).toContain(
      'tesserax_jobs_total{name="webhook",status="failed",service="worker"} 1',
    );
    expect(text).toContain(
      'tesserax_queue_jobs{queue="tesserax",state="waiting",service="worker"} 3',
    );
    expect(text).toMatch(/tesserax_job_duration_seconds_count\{[^}]*name="webhook"[^}]*\} 1/);
    expect(text).toContain('process_cpu_user_seconds_total');
    expect((await fetch(url('/autre'))).status).toBe(404);
  });
});
