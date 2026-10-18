import { type WebhookJob } from '@tesserax/jobs';
import { createHmac } from 'node:crypto';
import { lookup, type LookupAddress, type LookupAllOptions } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { type Pool } from 'pg';
import { Agent, fetch as undiciFetch } from 'undici';
import { inInstance } from './db.js';

/** Réseaux non joignables par un webhook (sauf `WEBHOOK_ALLOW_PRIVATE`) : protection SSRF. */
const PRIVATE = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  PRIVATE.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
] as const) {
  PRIVATE.addSubnet(net, prefix, 'ipv6');
}

export function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return PRIVATE.check(mapped[1]!, 'ipv4');
  const family = isIP(address);
  if (family === 0) return false;
  return PRIVATE.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * Agent HTTP qui refuse, à la connexion, toute adresse privée résolue : vérifier l'URL avant
 * l'envoi ne suffit pas (un nom peut être résolu autrement ensuite).
 */
export function publicOnlyAgent(): Agent {
  return new Agent({
    connect: {
      lookup: (hostname, options, callback) => {
        lookup(
          hostname,
          { ...(options as object), all: true } as LookupAllOptions,
          (error, addresses: LookupAddress[]) => {
            if (error) return callback(error, '', 0);
            const refused = addresses.find((a) => isPrivateAddress(a.address));
            if (refused) {
              return callback(
                new Error(`Adresse privée refusée : ${hostname} (${refused.address})`),
                '',
                0,
              );
            }
            if ((options as { all?: boolean }).all)
              return (callback as unknown as (e: null, a: LookupAddress[]) => void)(
                null,
                addresses,
              );
            return callback(null, addresses[0]!.address, addresses[0]!.family);
          },
        );
      },
    },
  });
}

export function sign(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

export interface WebhookDeps {
  db: Pool;
  /** Requête HTTP (undici) ; remplaçable dans les tests. */
  send: (
    url: string,
    init: { headers: Record<string, string>; body: string },
  ) => Promise<{ status: number }>;
  /** Livraisons échouées consécutives avant désactivation du webhook. */
  disableAfter: number;
  final: boolean;
  now?: () => Date;
}

interface DeliveryRow {
  event: string;
  payload: unknown;
  status: string;
  created_at: Date;
  url: string;
  secret: string;
  disabled_at: Date | null;
  deleted_at: Date | null;
  webhook_id: string;
}

/** Envoi HTTP réel : délai de 10 s, pas de suivi de redirection, garde SSRF facultative. */
export function httpSender(allowPrivate: boolean): WebhookDeps['send'] {
  const dispatcher = allowPrivate ? undefined : publicOnlyAgent();
  return async (url, init) => {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
    if (!allowPrivate && isPrivateAddress(host))
      throw new Error(`Adresse privée refusée : ${host}`);
    const response = await undiciFetch(url, {
      method: 'POST',
      headers: init.headers,
      body: init.body,
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
      ...(dispatcher ? { dispatcher } : {}),
    });
    await response.body?.cancel();
    return { status: response.status };
  };
}

/**
 * Job `webhook` (P5.4) : livre un événement, signé HMAC-SHA256 avec horodatage. Un échec est
 * retenté (backoff exponentiel) ; après `disableAfter` livraisons échouées d'affilée, le
 * webhook est désactivé. Une livraison réussie remet le compteur à zéro.
 */
export async function processWebhook(
  job: WebhookJob,
  deps: WebhookDeps,
): Promise<'delivered' | 'skipped'> {
  const row = await inInstance(deps.db, job.instanceId, async (client) => {
    const { rows } = await client.query<DeliveryRow>(
      `SELECT d.event, d.payload, d.status, d.created_at, w.url, w.secret, w.disabled_at,
              w.deleted_at, w.id AS webhook_id
       FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id WHERE d.id = $1`,
      [job.deliveryId],
    );
    return rows[0];
  });
  if (!row || row.status === 'delivered' || row.status === 'cancelled') return 'skipped';
  if (row.disabled_at || row.deleted_at) {
    await inInstance(deps.db, job.instanceId, (client) =>
      client.query(
        `UPDATE webhook_deliveries SET status = 'cancelled', error = $2, updated_at = now() WHERE id = $1`,
        [job.deliveryId, row.deleted_at ? 'Webhook supprimé' : 'Webhook désactivé'],
      ),
    );
    return 'skipped';
  }

  const body = JSON.stringify({
    id: job.deliveryId,
    event: row.event,
    createdAt: row.created_at,
    data: row.payload,
  });
  const timestamp = Math.floor((deps.now?.() ?? new Date()).getTime() / 1000);
  const started = Date.now();
  let status: number | null = null;
  let error: string | null = null;
  try {
    ({ status } = await deps.send(row.url, {
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Tesserax-Webhooks/1',
        'x-tesserax-event': row.event,
        'x-tesserax-delivery': job.deliveryId,
        'x-tesserax-timestamp': String(timestamp),
        'x-tesserax-signature': `sha256=${sign(row.secret, timestamp, body)}`,
      },
      body,
    }));
    if (status < 200 || status >= 300) error = `HTTP ${status}`;
  } catch (cause) {
    error = (cause as Error).message.slice(0, 500);
  }
  const durationMs = Date.now() - started;

  await inInstance(deps.db, job.instanceId, async (client) => {
    if (!error) {
      await client.query(
        `UPDATE webhook_deliveries SET status = 'delivered', attempts = attempts + 1, response_status = $2,
           duration_ms = $3, error = NULL, delivered_at = now(), updated_at = now() WHERE id = $1`,
        [job.deliveryId, status, durationMs],
      );
      await client.query(
        'UPDATE webhooks SET consecutive_failures = 0, updated_at = now() WHERE id = $1',
        [row.webhook_id],
      );
      return;
    }
    await client.query(
      `UPDATE webhook_deliveries SET status = $2, attempts = attempts + 1, response_status = $3,
         duration_ms = $4, error = $5, updated_at = now() WHERE id = $1`,
      [job.deliveryId, deps.final ? 'failed' : 'pending', status, durationMs, error],
    );
    if (deps.final) {
      await client.query(
        `UPDATE webhooks SET consecutive_failures = consecutive_failures + 1,
           disabled_at = CASE WHEN consecutive_failures + 1 >= $2 THEN now() ELSE disabled_at END,
           disabled_reason = CASE WHEN consecutive_failures + 1 >= $2
             THEN $3 ELSE disabled_reason END,
           updated_at = now()
         WHERE id = $1 AND disabled_at IS NULL`,
        [
          row.webhook_id,
          deps.disableAfter,
          `${deps.disableAfter} livraisons échouées d'affilée (dernière : ${error})`,
        ],
      );
    }
  });
  if (error) throw new Error(`Webhook ${row.url} : ${error}`);
  return 'delivered';
}
