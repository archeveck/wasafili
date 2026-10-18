import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { processEmail } from './email.js';
import { httpSender, isPrivateAddress, processWebhook } from './webhook.js';

function database(row: Record<string, unknown> | undefined) {
  const queries: [string, unknown[]?][] = [];
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      queries.push([sql.replace(/\s+/g, ' ').trim(), params]);
      return { rows: sql.trim().startsWith('SELECT') && row ? [row] : [] };
    }),
    release: vi.fn(),
  };
  return { queries, db: { connect: async () => client } as never };
}

const updates = (queries: [string, unknown[]?][]) =>
  queries.filter(([sql]) => sql.startsWith('UPDATE'));

describe('processWebhook', () => {
  const delivery = {
    event: 'submission.created',
    payload: { submissionId: 's1' },
    status: 'pending',
    created_at: new Date('2026-10-18T10:00:00Z'),
    url: 'https://hooks.example.ci/tesserax',
    secret: 'secret-de-test',
    disabled_at: null,
    deleted_at: null,
    webhook_id: 'w1',
  };
  const job = { instanceId: 'i1', deliveryId: 'd1' };
  const now = () => new Date('2026-10-18T10:00:05Z');

  it('signe la requête (HMAC-SHA256 de « horodatage.corps ») et remet le compteur à zéro', async () => {
    const { db, queries } = database(delivery);
    const send = vi.fn(async () => ({ status: 204 }));
    expect(await processWebhook(job, { db, send, disableAfter: 5, final: false, now })).toBe(
      'delivered',
    );
    const [url, init] = send.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(url).toBe(delivery.url);
    const expected = createHmac('sha256', 'secret-de-test')
      .update(`1792317605.${init.body}`)
      .digest('hex');
    expect(init.headers).toMatchObject({
      'x-tesserax-event': 'submission.created',
      'x-tesserax-delivery': 'd1',
      'x-tesserax-timestamp': '1792317605',
      'x-tesserax-signature': `sha256=${expected}`,
    });
    expect(JSON.parse(init.body)).toEqual({
      id: 'd1',
      event: 'submission.created',
      createdAt: '2026-10-18T10:00:00.000Z',
      data: { submissionId: 's1' },
    });
    expect(updates(queries).map(([sql]) => sql)).toEqual([
      expect.stringContaining("status = 'delivered'"),
      expect.stringContaining('consecutive_failures = 0'),
    ]);
  });

  it('échoue pour être retenté ; à la dernière tentative, compte l’échec et désactive au seuil', async () => {
    const pending = database(delivery);
    const send = vi.fn(async () => ({ status: 500 }));
    await expect(
      processWebhook(job, { db: pending.db, send, disableAfter: 3, final: false, now }),
    ).rejects.toThrow('HTTP 500');
    expect(updates(pending.queries)).toHaveLength(1);
    expect(updates(pending.queries)[0]![1]).toContain('pending');

    const last = database(delivery);
    await expect(
      processWebhook(job, { db: last.db, send, disableAfter: 3, final: true, now }),
    ).rejects.toThrow();
    const [failed, webhook] = updates(last.queries);
    expect(failed![1]).toContain('failed');
    expect(webhook![0]).toContain('consecutive_failures = consecutive_failures + 1');
    expect(webhook![1]).toEqual(['w1', 3, expect.stringContaining('3 livraisons échouées')]);
  });

  it('annule la livraison d’un webhook désactivé, ignore une livraison déjà faite', async () => {
    const disabled = database({ ...delivery, disabled_at: new Date() });
    const send = vi.fn();
    expect(
      await processWebhook(job, { db: disabled.db, send, disableAfter: 5, final: false }),
    ).toBe('skipped');
    expect(updates(disabled.queries)[0]![1]).toEqual(['d1', 'Webhook désactivé']);
    const done = database({ ...delivery, status: 'delivered' });
    expect(await processWebhook(job, { db: done.db, send, disableAfter: 5, final: false })).toBe(
      'skipped',
    );
    expect(send).not.toHaveBeenCalled();
  });
});

describe('garde SSRF', () => {
  let server: Server;
  let port: number;
  beforeAll(async () => {
    server = createServer((_req, res) => res.writeHead(202).end());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as { port: number }).port;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('reconnaît les adresses privées', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '192.168.1.10',
      '169.254.169.254',
      '::1',
      '::ffff:10.0.0.1',
      'fd00::1',
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
    for (const address of ['8.8.8.8', '41.202.1.1', '2a00:1450::1']) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });

  it('refuse une adresse privée, littérale ou résolue, sauf autorisation explicite', async () => {
    const init = { headers: {}, body: '{}' };
    await expect(httpSender(false)(`http://127.0.0.1:${port}/`, init)).rejects.toThrow(
      'Adresse privée refusée',
    );
    await expect(httpSender(false)(`http://localhost:${port}/`, init)).rejects.toThrow();
    expect(await httpSender(true)(`http://127.0.0.1:${port}/`, init)).toEqual({ status: 202 });
  });
});

describe('processEmail', () => {
  const row = {
    to: ['chef@example.ci'],
    subject: 'Fiche validée',
    text: 'Bonjour',
    html: '<p>Bonjour</p>',
    attachments: [
      { key: 'i1/reports/x.pdf', filename: 'Rapport.pdf', contentType: 'application/pdf' },
    ],
    status: 'queued',
  };
  const s3 = {
    send: vi.fn(async () => ({
      Body: { transformToByteArray: async () => new Uint8Array([37, 80]) },
    })),
  } as never;
  const job = { instanceId: 'i1', emailId: 'e1' };

  it('envoie avec les pièces jointes du stockage et enregistre l’envoi', async () => {
    const { db, queries } = database(row);
    const sendMail = vi.fn(async () => ({ messageId: '<m1@test>' }));
    expect(
      await processEmail(job, {
        db,
        s3,
        bucket: 'b',
        mailer: { sendMail },
        from: 'T <t@t>',
        final: false,
      }),
    ).toBe('sent');
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'T <t@t>',
        to: ['chef@example.ci'],
        attachments: [
          {
            filename: 'Rapport.pdf',
            contentType: 'application/pdf',
            content: Buffer.from([37, 80]),
          },
        ],
      }),
    );
    expect(updates(queries)[0]![1]).toEqual(['e1', 'sent', null, '<m1@test>', expect.any(Date)]);
  });

  it('ne renvoie pas un e-mail déjà envoyé ; explique l’absence de SMTP', async () => {
    const sent = database({ ...row, status: 'sent' });
    const sendMail = vi.fn();
    expect(
      await processEmail(job, {
        db: sent.db,
        s3,
        bucket: 'b',
        mailer: { sendMail },
        from: 'x',
        final: false,
      }),
    ).toBe('skipped');
    expect(sendMail).not.toHaveBeenCalled();

    const none = database(row);
    await expect(
      processEmail(job, {
        db: none.db,
        s3,
        bucket: 'b',
        mailer: undefined,
        from: 'x',
        final: true,
      }),
    ).rejects.toThrow('SMTP non configuré');
    expect(updates(none.queries)[0]![1]).toEqual(['e1', 'failed', 'SMTP non configuré (SMTP_URL)']);
  });
});
