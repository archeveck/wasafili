import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ENV, type Env } from '../config/env';

/** Durée de validité des URL signées (secondes). */
export const SIGNED_URL_TTL = 15 * 60;

/**
 * Accès au stockage S3 (MinIO). Les fichiers des clients ne transitent pas par l'API (URL
 * signées) ; seuls les documents qu'elle produit ou fusionne (rapports) y passent.
 */
@Injectable()
export class StorageService {
  private readonly internal?: S3Client;
  private readonly public?: S3Client;
  readonly bucket: string;

  constructor(@Inject(ENV) env: Env) {
    this.bucket = env.S3_BUCKET;
    if (env.S3_ENDPOINT && env.S3_ACCESS_KEY && env.S3_SECRET_KEY) {
      const client = (endpoint: string) =>
        new S3Client({
          endpoint,
          region: env.S3_REGION,
          forcePathStyle: true,
          credentials: { accessKeyId: env.S3_ACCESS_KEY!, secretAccessKey: env.S3_SECRET_KEY! },
        });
      this.internal = client(env.S3_ENDPOINT);
      // Les URL signées doivent viser l'adresse vue du client (navigateur, mobile).
      this.public = client(env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT);
    }
  }

  /** URL de dépôt : type et taille sont signés, le client ne peut pas les changer. */
  uploadUrl(key: string, mimeType: string, size: number): Promise<string> {
    return getSignedUrl(
      this.clients().public,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: mimeType,
        ContentLength: size,
      }),
      { expiresIn: SIGNED_URL_TTL, signableHeaders: new Set(['content-type', 'content-length']) },
    );
  }

  /** Durée de validité des URL signées, en secondes. */
  readonly signedUrlTtl = SIGNED_URL_TTL;

  downloadUrl(
    key: string,
    filename?: string,
    disposition: 'inline' | 'attachment' = 'inline',
  ): Promise<string> {
    return getSignedUrl(
      this.clients().public,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(filename
          ? {
              ResponseContentDisposition: `${disposition}; filename*=UTF-8''${encodeURIComponent(filename)}`,
            }
          : {}),
      }),
      { expiresIn: SIGNED_URL_TTL },
    );
  }

  /** Premiers octets d'un objet (vérification de signature). */
  async readStart(key: string, bytes: number): Promise<Buffer> {
    const object = await this.clients().internal.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=0-${bytes - 1}` }),
    );
    return Buffer.from(await object.Body!.transformToByteArray());
  }

  /** Sonde de santé : le bucket existe et les identifiants sont valides. */
  async ping(): Promise<void> {
    await this.clients().internal.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  /** Contenu d'un objet (modèles de rapports, images à intégrer). */
  async get(key: string): Promise<Buffer> {
    const object = await this.clients().internal.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return Buffer.from(await object.Body!.transformToByteArray());
  }

  /** Dépôt d'un objet produit par l'API (rapports PDF). */
  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.clients().internal.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  /** Métadonnées de l'objet, ou `undefined` s'il n'existe pas (encore). */
  async head(key: string): Promise<{ size: number; contentType?: string } | undefined> {
    try {
      const head = await this.clients().internal.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        size: head.ContentLength ?? 0,
        ...(head.ContentType ? { contentType: head.ContentType } : {}),
      };
    } catch (error) {
      if ((error as { name?: string }).name === 'NotFound') return undefined;
      throw error;
    }
  }

  private clients() {
    if (!this.internal || !this.public) {
      throw new ServiceUnavailableException({
        error: 'storage_unavailable',
        message: 'Stockage de fichiers non configuré',
      });
    }
    return { internal: this.internal, public: this.public };
  }
}
