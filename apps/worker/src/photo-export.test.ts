import { S3Client } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { archiveKey, cleanupPhotoExports, processPhotoExport } from './photo-export.js';

const job = { instanceId: 'i1', exportId: 'e1' };
const entries = [
  { key: 'i1/a', name: '2026-10-18_abc/photos_1.jpg' },
  { key: 'i1/b', name: '2026-10-18_abc/photos_2.jpg' },
];

/** Client S3 factice : objets sources en mémoire, envoi de l'archive capturé. */
function fakeS3(objects: Record<string, string>) {
  const uploaded: Buffer[] = [];
  const commands: string[] = [];
  // Vrai client (l'envoi multipart lit sa configuration), dont seul `send` est simulé.
  const s3 = new S3Client({
    endpoint: 'http://storage.invalid',
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'k', secretAccessKey: 's' },
  });
  s3.send = vi.fn(
    async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
      const name = command.constructor.name;
      commands.push(`${name} ${String(command.input['Key'])}`);
      if (name === 'GetObjectCommand') {
        const content = objects[command.input['Key'] as string];
        if (content === undefined) throw new Error('NoSuchKey');
        return { Body: Readable.from([Buffer.from(content)]) };
      }
      if (name === 'PutObjectCommand') {
        const body = command.input['Body'];
        uploaded.push(Buffer.isBuffer(body) ? body : Buffer.from(body as Uint8Array));
        return {};
      }
      if (name === 'HeadObjectCommand') return { ContentLength: uploaded[0]?.length };
      return {};
    },
  ) as never;
  return { s3, uploaded, commands };
}

function fakeDb(status = 'queued') {
  const queries: { sql: string; params: unknown[] }[] = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (sql.startsWith('SELECT status')) return { rows: [{ status, entries }] };
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return { db: { connect: async () => client } as never, queries };
}

describe('processPhotoExport', () => {
  it('assemble l archive en flux et l enregistre sur l export', async () => {
    const { s3, uploaded, commands } = fakeS3({ 'i1/a': 'PHOTO-A', 'i1/b': 'PHOTO-B' });
    const { db, queries } = fakeDb();
    await expect(
      processPhotoExport(job, { s3: s3 as never, bucket: 'b', db, final: false }),
    ).resolves.toBe('done');

    const zip = uploaded[0]!;
    expect(zip.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    const text = zip.toString('latin1');
    // Photos stockées sans recompression : leur contenu figure tel quel dans l'archive.
    for (const marker of ['PHOTO-A', 'PHOTO-B', entries[0]!.name, entries[1]!.name]) {
      expect(text).toContain(marker);
    }
    expect(commands).toContain(`PutObjectCommand ${archiveKey('i1', 'e1')}`);
    const done = queries.find((q) => q.sql.includes("status = 'succeeded'"))!;
    expect(done.params).toEqual(['e1', archiveKey('i1', 'e1'), zip.length]);
  });

  it('ne refait pas un export déjà terminé', async () => {
    const { s3 } = fakeS3({});
    const { db } = fakeDb('succeeded');
    await expect(
      processPhotoExport(job, { s3: s3 as never, bucket: 'b', db, final: false }),
    ).resolves.toBe('skipped');
    expect(s3.send).not.toHaveBeenCalled();
  });

  it('enregistre l échec à la dernière tentative, le remet en file sinon', async () => {
    for (const final of [false, true]) {
      const { s3 } = fakeS3({ 'i1/a': 'PHOTO-A' });
      const { db, queries } = fakeDb();
      await expect(
        processPhotoExport(job, { s3: s3 as never, bucket: 'b', db, final }),
      ).rejects.toThrow(/Photo illisible/);
      const failure = queries.find((q) => q.sql.includes('error = $3'))!;
      expect(failure.params[1]).toBe(final ? 'failed' : 'queued');
    }
  });
});

describe('cleanupPhotoExports', () => {
  it('supprime les archives expirées de chaque instance', async () => {
    const { s3, commands } = fakeS3({});
    const client = {
      query: vi.fn(async (sql: string) =>
        sql.startsWith('SELECT id, key')
          ? { rows: [{ id: 'e1', key: 'i1/exports/e1.zip' }] }
          : { rows: [] },
      ),
      release: vi.fn(),
    };
    const db = {
      query: async () => ({ rows: [{ id: 'i1' }] }),
      connect: async () => client,
    };
    expect(await cleanupPhotoExports({ s3: s3 as never, bucket: 'b', db: db as never })).toBe(1);
    expect(commands).toEqual(['DeleteObjectCommand i1/exports/e1.zip']);
  });
});
