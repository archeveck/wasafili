import { type PushJob } from '@tesserax/jobs';
import { type Pool } from 'pg';
import { inInstance } from './db.js';

/** Taille maximale d'un envoi accepté par le service Expo. */
const BATCH = 100;

export interface PushDeps {
  db: Pool;
  fetch: typeof fetch;
  url: string;
  accessToken?: string;
}

interface Ticket {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

/**
 * Job `push` (P4.5, D1) : relaie des notifications enregistrées vers les appareils de leurs
 * destinataires via Expo Push. Les notifications restent disponibles par la sync : un échec
 * d'envoi n'en perd aucune. Un jeton refusé (`DeviceNotRegistered`) est supprimé.
 */
export async function processPush(job: PushJob, deps: PushDeps): Promise<{ sent: number }> {
  const messages = await inInstance(deps.db, job.instanceId, async (client) => {
    const { rows } = await client.query<{
      token: string;
      title: string;
      body: string | null;
      data: Record<string, unknown>;
      id: string;
    }>(
      `SELECT t.token, n.title, n.body, n.data, n.id FROM notifications n
       JOIN push_tokens t ON t.user_id = n.user_id
       WHERE n.id = ANY($1::uuid[]) AND n.read_at IS NULL`,
      [job.notificationIds],
    );
    return rows.map((row) => ({
      to: row.token,
      title: row.title,
      ...(row.body ? { body: row.body } : {}),
      data: { ...row.data, notificationId: row.id },
      sound: 'default' as const,
    }));
  });

  const rejected: string[] = [];
  for (let start = 0; start < messages.length; start += BATCH) {
    const batch = messages.slice(start, start + BATCH);
    const response = await deps.fetch(deps.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(deps.accessToken ? { authorization: `Bearer ${deps.accessToken}` } : {}),
      },
      body: JSON.stringify(batch),
    });
    // Erreur du service : le job est retenté (BullMQ, backoff exponentiel).
    if (!response.ok) throw new Error(`Expo Push : HTTP ${response.status}`);
    const { data } = (await response.json()) as { data: Ticket[] };
    data.forEach((ticket, index) => {
      if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
        rejected.push(batch[index]!.to);
      }
    });
  }
  if (rejected.length > 0) {
    await inInstance(deps.db, job.instanceId, (client) =>
      client.query('DELETE FROM push_tokens WHERE token = ANY($1::text[])', [rejected]),
    );
  }
  return { sent: messages.length };
}
