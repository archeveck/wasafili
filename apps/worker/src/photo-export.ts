import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { type PhotoExportJob } from '@wasafili/jobs';
import { type Pool } from 'pg';
import { PassThrough, type Readable } from 'node:stream';
import yazl from 'yazl';
import { inInstance } from './db.js';

export interface PhotoExportDeps {
  s3: S3Client;
  bucket: string;
  db: Pool;
  /** Dernière tentative : l'échec est enregistré sur l'export. */
  final: boolean;
}

interface Entry {
  key: string;
  name: string;
}

/** Clé de l'archive d'un export dans le bucket. */
export const archiveKey = (instanceId: string, exportId: string) =>
  `${instanceId}/exports/${exportId}.zip`;

/**
 * Job `photos-zip` (P6.4) : assemble l'archive en flux, sans la tenir en mémoire ni sur
 * disque. Chaque photo n'est demandée au stockage qu'au moment de l'écrire ; l'archive part
 * en envoi multipart. Les photos sont déjà compressées : elles sont stockées telles quelles.
 */
export async function processPhotoExport(
  job: PhotoExportJob,
  deps: PhotoExportDeps,
): Promise<'done' | 'skipped'> {
  const row = await inInstance(deps.db, job.instanceId, async (client) => {
    const { rows } = await client.query<{ status: string; entries: Entry[] }>(
      'SELECT status, entries FROM photo_exports WHERE id = $1 FOR UPDATE',
      [job.exportId],
    );
    if (!rows[0] || rows[0].status === 'succeeded') return undefined;
    await client.query(
      "UPDATE photo_exports SET status = 'running', error = NULL, updated_at = now() WHERE id = $1",
      [job.exportId],
    );
    return rows[0];
  });
  if (!row) return 'skipped';

  const key = archiveKey(job.instanceId, job.exportId);
  try {
    await writeArchive(deps, key, row.entries);
    const head = await deps.s3.send(new HeadObjectCommand({ Bucket: deps.bucket, Key: key }));
    await inInstance(deps.db, job.instanceId, (client) =>
      client.query(
        `UPDATE photo_exports SET status = 'succeeded', key = $2, size = $3,
           completed_at = now(), updated_at = now() WHERE id = $1`,
        [job.exportId, key, head.ContentLength ?? null],
      ),
    );
    return 'done';
  } catch (error) {
    await inInstance(deps.db, job.instanceId, (client) =>
      client.query(
        `UPDATE photo_exports SET status = $2, error = $3,
           completed_at = CASE WHEN $2 = 'failed' THEN now() END, updated_at = now() WHERE id = $1`,
        [
          job.exportId,
          deps.final ? 'failed' : 'queued',
          error instanceof Error ? error.message.slice(0, 500) : String(error),
        ],
      ),
    );
    throw error;
  }
}

async function writeArchive(deps: PhotoExportDeps, key: string, entries: Entry[]) {
  const zip = new yazl.ZipFile();
  const body = new PassThrough();
  zip.outputStream.pipe(body);
  const upload = new Upload({
    client: deps.s3,
    params: { Bucket: deps.bucket, Key: key, Body: body, ContentType: 'application/zip' },
  });
  const failed = new Promise<never>((_resolve, reject) => {
    zip.on('error', (error: unknown) => {
      void upload.abort();
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
  for (const entry of entries) {
    zip.addReadStreamLazy(entry.name, { compress: false }, (callback) => {
      deps.s3
        .send(new GetObjectCommand({ Bucket: deps.bucket, Key: entry.key }))
        .then((object) => callback(null, object.Body as Readable))
        .catch((error: unknown) =>
          callback(new Error(`Photo illisible (${entry.name}) : ${String(error)}`), undefined!),
        );
    });
  }
  zip.end();
  await Promise.race([upload.done(), failed]);
}

/** Purge des archives expirées : objet supprimé, export conservé (historique, audit). */
export async function cleanupPhotoExports(deps: Omit<PhotoExportDeps, 'final'>): Promise<number> {
  const { rows: instances } = await deps.db.query<{ id: string }>('SELECT id FROM instances');
  let removed = 0;
  for (const { id } of instances) {
    const expired = await inInstance(deps.db, id, async (client) => {
      const { rows } = await client.query<{ id: string; key: string }>(
        'SELECT id, key FROM photo_exports WHERE key IS NOT NULL AND expires_at <= now()',
      );
      return rows;
    });
    for (const row of expired) {
      await deps.s3.send(new DeleteObjectCommand({ Bucket: deps.bucket, Key: row.key }));
      await inInstance(deps.db, id, (client) =>
        client.query('UPDATE photo_exports SET key = NULL, updated_at = now() WHERE id = $1', [
          row.id,
        ]),
      );
      removed += 1;
    }
  }
  return removed;
}
