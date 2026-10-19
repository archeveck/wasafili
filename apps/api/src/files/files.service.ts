import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { type Actor } from '../auth/decorators';
import { ENV, type Env } from '../config/env';
import { type File } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JobQueue } from '../queue/queue.module';
import { isBlockedType, isInlineType, matchesSignature, SIGNATURE_BYTES } from './content-types';
import { SIGNED_URL_TTL, StorageService } from './storage.service';

const NOT_FOUND = { error: 'not_found', message: 'Fichier introuvable' };

export interface UploadRequest {
  id?: string;
  name: string;
  mimeType: string;
  size: number;
}

/**
 * Fichiers (D10) : l'API émet une URL signée, le client dépose l'objet directement dans le
 * stockage puis confirme. Rejouer la demande avec le même identifiant renvoie une nouvelle URL
 * (reprise après coupure) sans créer de doublon.
 */
@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly queue: JobQueue,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async requestUpload(instanceId: string, actor: Actor, input: UploadRequest) {
    if (isBlockedType(input.mimeType)) {
      throw new UnsupportedMediaTypeException({
        error: 'unsupported_media_type',
        message: `Type de fichier refusé : ${input.mimeType}`,
      });
    }
    if (input.size > this.env.MAX_UPLOAD_BYTES) {
      throw new BadRequestException({
        error: 'file_too_large',
        message: `Taille maximale : ${Math.floor(this.env.MAX_UPLOAD_BYTES / 1024 / 1024)} Mo`,
      });
    }
    let file = input.id ? await this.prisma.db.file.findUnique({ where: { id: input.id } }) : null;
    if (file) {
      if (file.size !== input.size || file.mimeType !== input.mimeType) {
        throw new ConflictException({
          error: 'conflict',
          message: 'Ce fichier existe déjà avec un autre contenu',
        });
      }
      if (file.status === 'uploaded') return { file: await this.toDto(file), upload: null };
    } else {
      const id = input.id ?? crypto.randomUUID();
      file = await this.prisma.db.file.create({
        data: {
          id,
          instanceId,
          key: `${instanceId}/${id}`,
          name: input.name,
          mimeType: input.mimeType,
          size: input.size,
          createdById: actor.userId,
        },
      });
    }
    return {
      file: await this.toDto(file),
      upload: {
        method: 'PUT' as const,
        url: await this.storage.uploadUrl(file.key, file.mimeType, file.size),
        headers: { 'Content-Type': file.mimeType },
        expiresAt: new Date(Date.now() + SIGNED_URL_TTL * 1000),
      },
    };
  }

  /** Confirme le dépôt : l'objet doit exister avec la taille annoncée. */
  async complete(id: string) {
    const file = await this.find(id);
    if (file.status === 'uploaded') return this.toDto(file);
    const head = await this.storage.head(file.key);
    if (!head) {
      throw new ConflictException({
        error: 'upload_missing',
        message: 'Fichier non encore déposé',
      });
    }
    if (head.size !== file.size) {
      throw new ConflictException({
        error: 'upload_mismatch',
        message: 'Taille du fichier déposé incorrecte',
      });
    }
    // Une image ou un PDF (affichés dans le navigateur) doit en être vraiment un. Le fichier
    // reste en attente : le client peut redéposer le bon contenu sous le même identifiant.
    if (!matchesSignature(file.mimeType, await this.storage.readStart(file.key, SIGNATURE_BYTES))) {
      throw new UnprocessableEntityException({
        error: 'file_content_mismatch',
        message: `Le contenu ne correspond pas au type annoncé (${file.mimeType})`,
      });
    }
    const updated = await this.prisma.db.file.update({
      where: { id },
      data: { status: 'uploaded' },
    });
    if (file.mimeType.startsWith('image/')) {
      await this.queue.add(
        'thumbnail',
        {
          instanceId: file.instanceId,
          fileId: file.id,
          key: file.key,
          thumbnailKey: `${file.instanceId}/thumbs/${file.id}.jpg`,
        },
        `thumbnail-${file.id}`,
      );
    }
    return this.toDto(updated);
  }

  async get(id: string) {
    return this.toDto(await this.find(id));
  }

  private async find(id: string): Promise<File> {
    const file = await this.prisma.db.file.findUnique({ where: { id } });
    if (!file) throw new NotFoundException(NOT_FOUND);
    return file;
  }

  private async toDto(file: File) {
    const uploaded = file.status === 'uploaded';
    return {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      status: file.status,
      createdAt: file.createdAt,
      // Seuls les types vérifiés s'affichent dans le navigateur ; les autres se téléchargent.
      url: uploaded
        ? await this.storage.downloadUrl(
            file.key,
            file.name,
            isInlineType(file.mimeType) ? 'inline' : 'attachment',
          )
        : null,
      thumbnailUrl:
        uploaded && file.thumbnailKey ? await this.storage.downloadUrl(file.thumbnailKey) : null,
    };
  }
}
