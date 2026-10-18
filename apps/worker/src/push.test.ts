import { describe, expect, it, vi } from 'vitest';
import { processPush } from './push.js';

const rows = [
  {
    token: 'ExponentPushToken[a]',
    title: 'Nouvelle tâche',
    body: 'Contrôle',
    data: { taskId: 't1' },
    id: 'n1',
  },
  { token: 'ExponentPushToken[b]', title: 'Nouvelle tâche', body: null, data: {}, id: 'n1' },
];

function database() {
  const queries: [string, unknown[]?][] = [];
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      queries.push([sql, params]);
      return { rows: sql.startsWith('SELECT t.token') ? rows : [] };
    }),
    release: vi.fn(),
  };
  return { queries, db: { connect: async () => client } as never };
}

const job = { instanceId: 'i1', notificationIds: ['n1'] };

describe('processPush', () => {
  it('envoie les notifications non lues et supprime les jetons refusés', async () => {
    const { queries, db } = database();
    const fetch = vi.fn(async () =>
      Response.json({
        data: [
          { status: 'ok', id: 'x' },
          { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
        ],
      }),
    );
    expect(
      await processPush(job, { db, fetch, url: 'https://push.test', accessToken: 'k' }),
    ).toEqual({
      sent: 2,
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://push.test');
    expect(init.headers).toMatchObject({ authorization: 'Bearer k' });
    expect(JSON.parse(init.body as string)).toEqual([
      {
        to: 'ExponentPushToken[a]',
        title: 'Nouvelle tâche',
        body: 'Contrôle',
        data: { taskId: 't1', notificationId: 'n1' },
        sound: 'default',
      },
      {
        to: 'ExponentPushToken[b]',
        title: 'Nouvelle tâche',
        data: { notificationId: 'n1' },
        sound: 'default',
      },
    ]);
    expect(queries.at(-2)).toEqual([
      'DELETE FROM push_tokens WHERE token = ANY($1::text[])',
      [['ExponentPushToken[b]']],
    ]);
  });

  it('échoue (pour être retenté) si le service refuse la requête', async () => {
    const { db } = database();
    const fetch = vi.fn(async () => new Response('busy', { status: 503 }));
    await expect(processPush(job, { db, fetch, url: 'https://push.test' })).rejects.toThrow(
      'HTTP 503',
    );
  });
});
