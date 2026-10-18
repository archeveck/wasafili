import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { THUMBNAIL_SIZE, type ThumbnailJob } from '@tesserax/jobs';
import { type Pool } from 'pg';
import sharp from 'sharp';

/** Miniature JPEG tenant dans un carré de THUMBNAIL_SIZE px, orientation EXIF appliquée. */
export function makeThumbnail(source: Buffer): Promise<Buffer> {
  return sharp(source)
    .rotate()
    .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 70, mozjpeg: true })
    .toBuffer();
}

export interface ThumbnailDeps {
  s3: S3Client;
  bucket: string;
  db: Pool;
}

/** Job `thumbnail` : lit l'original, écrit la miniature, l'enregistre sur le fichier. */
export async function processThumbnail(job: ThumbnailJob, deps: ThumbnailDeps): Promise<void> {
  const object = await deps.s3.send(new GetObjectCommand({ Bucket: deps.bucket, Key: job.key }));
  const source = Buffer.from(await object.Body!.transformToByteArray());
  await deps.s3.send(
    new PutObjectCommand({
      Bucket: deps.bucket,
      Key: job.thumbnailKey,
      Body: await makeThumbnail(source),
      ContentType: 'image/jpeg',
    }),
  );
  // Même isolation que l'API : le contexte d'instance est posé pour la transaction.
  const client = await deps.db.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.instance_id', $1, true)", [job.instanceId]);
    await client.query('UPDATE files SET thumbnail_key = $1, updated_at = now() WHERE id = $2', [
      job.thumbnailKey,
      job.fileId,
    ]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
