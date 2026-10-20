import {
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { type FileRef, type StructureDefinition, walkFields } from '@wasafili/form-schema';
import { PHOTO_EXPORT_TTL_MS } from '@wasafili/jobs';
import { type Actor } from '../auth/decorators';
import { pageArgs, type Pagination, toPage } from '../common/pagination';
import { type Instance, type PhotoExport, type Prisma } from '../generated/prisma/client';
import { StorageService } from '../files/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { JobQueue } from '../queue/queue.module';
import { StructuresService } from '../structures/structures.service';
import { type ListSubmissionsInput, SubmissionsService } from '../submissions/submissions.service';
import {
  DEFAULT_PATTERN,
  extensionOf,
  patternErrors,
  renderPattern,
  uniquePaths,
} from './photo-names';

/** Fichiers archivés au plus par export. */
export const MAX_ZIP_FILES = 10_000;

const NOT_FOUND = { error: 'not_found', message: 'Export introuvable' };

export interface PhotoExportInput extends Omit<ListSubmissionsInput, 'page' | 'per_page'> {
  pattern?: string;
}

interface PhotoRef {
  submissionIndex: number;
  fieldKey: string;
  fieldLabel: string;
  n: number;
  ref: FileRef;
  annotated: boolean;
}

/** Date `AAAA-MM-JJ` dans le fuseau de l'instance. */
const localDate = (date: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' }).format(date);

/** Photos d'une fiche, champs de tableau compris : original, puis version annotée s'il y en a une. */
function photosOf(definition: StructureDefinition, data: Record<string, unknown>) {
  const photos: Omit<PhotoRef, 'submissionIndex'>[] = [];
  const push = (key: string, label: string, value: unknown) => {
    if (!Array.isArray(value)) return;
    for (const ref of value as FileRef[]) {
      if (!ref || typeof ref.fileId !== 'string') continue;
      const n = photos.filter((p) => p.fieldKey === key && !p.annotated).length + 1;
      photos.push({ fieldKey: key, fieldLabel: label, n, ref, annotated: false });
      if (ref.annotatedFileId) {
        photos.push({ fieldKey: key, fieldLabel: label, n, ref, annotated: true });
      }
    }
  };
  for (const { field, table } of walkFields(definition.fields)) {
    if (field.type !== 'photo') continue;
    if (!table) {
      push(field.key, field.label, data[field.key]);
      continue;
    }
    const rows = data[table.key];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (row && typeof row === 'object') {
        push(
          field.key,
          `${table.label} — ${field.label}`,
          (row as Record<string, unknown>)[field.key],
        );
      }
    }
  }
  return photos;
}

/**
 * Export ZIP des photos (P6.4, ADR 0010). L'API résout la sélection (droit d'export, filtres,
 * visibilité) et les chemins dans l'archive ; le worker assemble l'archive en flux depuis le
 * stockage. Le téléchargement passe par une URL signée de courte durée, émise à la demande
 * tant que l'export n'a pas expiré.
 */
@Injectable()
export class PhotoExportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly submissions: SubmissionsService,
    private readonly structures: StructuresService,
    private readonly storage: StorageService,
    private readonly queue: JobQueue,
  ) {}

  async create(instance: Instance, structureId: string, actor: Actor, input: PhotoExportInput) {
    if (!actor.userId) {
      throw new ForbiddenException({
        error: 'forbidden',
        message: 'Export réservé aux utilisateurs : il est rattaché à son demandeur',
      });
    }
    const pattern = input.pattern?.trim() || DEFAULT_PATTERN;
    const errors = patternErrors(pattern);
    if (errors.length > 0) {
      throw new UnprocessableEntityException({
        error: 'invalid_pattern',
        message: errors.join(' ; '),
        details: { errors },
      });
    }
    const structure = await this.structures.get(structureId);
    const { rows } = await this.submissions.exportSelection(structureId, actor, input);

    // Chaque fiche est lue avec sa propre version de structure.
    const versionIds = [...new Set(rows.map((row) => row.structureVersionId))];
    const versions = await this.prisma.db.structureVersion.findMany({
      where: { id: { in: versionIds } },
      select: { id: true, definition: true },
    });
    const definitions = new Map(
      versions.map((v) => [v.id, v.definition as unknown as StructureDefinition]),
    );
    const photos: PhotoRef[] = rows.flatMap((row, submissionIndex) =>
      photosOf(definitions.get(row.structureVersionId)!, row.data as Record<string, unknown>).map(
        (photo) => ({ ...photo, submissionIndex }),
      ),
    );
    if (photos.length > MAX_ZIP_FILES) {
      throw new UnprocessableEntityException({
        error: 'export_too_large',
        message: `Export limité à ${MAX_ZIP_FILES} photos : affinez les filtres`,
      });
    }

    const fileIds = photos.map((p) => (p.annotated ? p.ref.annotatedFileId! : p.ref.fileId));
    const [files, authors] = await Promise.all([
      this.prisma.db.file.findMany({
        where: { id: { in: [...new Set(fileIds)] }, status: 'uploaded' },
        select: { id: true, key: true, name: true, mimeType: true },
      }),
      this.prisma.db.user.findMany({
        where: { id: { in: rows.flatMap((r) => (r.authorId ? [r.authorId] : [])) } },
        select: { id: true, email: true },
      }),
    ]);
    const fileById = new Map(files.map((f) => [f.id, f]));
    const authorById = new Map(authors.map((a) => [a.id, a.email.split('@')[0]!]));
    const unique = uniquePaths();
    const entries: { key: string; name: string }[] = [];
    let missing = 0;
    photos.forEach((photo, index) => {
      const file = fileById.get(fileIds[index]!);
      if (!file) {
        missing += 1; // dépôt jamais terminé (mobile resté hors ligne) : rien à archiver
        return;
      }
      const row = rows[photo.submissionIndex]!;
      const original = file.name.replace(/\.[^.]*$/, '');
      const base = renderPattern(pattern, {
        structure: structure.name,
        fiche: row.id.slice(0, 8),
        id: row.id,
        date: localDate(row.createdAt, instance.timeZone),
        etat: row.state ?? '',
        auteur: row.authorId ? (authorById.get(row.authorId) ?? '') : '',
        champ: photo.fieldKey,
        libelle: photo.fieldLabel,
        n: String(photo.n),
        original,
        values: row.data as Record<string, unknown>,
      });
      entries.push({
        key: file.key,
        name: unique(
          photo.annotated ? `${base}-annotee` : base,
          extensionOf(file.mimeType, file.name),
        ),
      });
    });

    const created = await this.prisma.db.photoExport.create({
      data: {
        instanceId: instance.id,
        structureId,
        requestedById: actor.userId,
        pattern,
        entries: entries as Prisma.InputJsonArray,
        fileCount: entries.length,
        expiresAt: new Date(Date.now() + PHOTO_EXPORT_TTL_MS),
        ...(entries.length === 0
          ? { status: 'failed', error: 'Aucune photo dans la sélection', completedAt: new Date() }
          : {}),
      },
    });
    if (entries.length > 0) {
      await this.queue.add(
        'photos-zip',
        { instanceId: instance.id, exportId: created.id },
        created.id,
      );
    }
    return { ...this.toDto(created), missing };
  }

  /** Exports de l'appelant, les plus récents d'abord. */
  async list(actor: Actor, pagination: Pagination) {
    if (!actor.userId) return toPage([], 0, pagination);
    const where = { requestedById: actor.userId };
    const [rows, total] = await Promise.all([
      this.prisma.db.photoExport.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        omit: { entries: true },
        ...pageArgs(pagination),
      }),
      this.prisma.db.photoExport.count({ where }),
    ]);
    return toPage(
      rows.map((row) => this.toDto(row)),
      total,
      pagination,
    );
  }

  async get(id: string, actor: Actor) {
    return this.toDto(await this.find(id, actor));
  }

  /** URL signée de courte durée vers l'archive ; 410 une fois l'export expiré. */
  async download(id: string, actor: Actor) {
    const photoExport = await this.find(id, actor);
    if (photoExport.expiresAt <= new Date()) {
      throw new GoneException({ error: 'expired', message: 'Export expiré : relancez-le' });
    }
    if (photoExport.status !== 'succeeded' || !photoExport.key) {
      throw new UnprocessableEntityException({
        error: 'not_ready',
        message: 'L’archive n’est pas encore prête',
      });
    }
    const structure = await this.structures.get(photoExport.structureId);
    const filename = `${structure.name} - photos.zip`;
    return {
      id: photoExport.id,
      url: await this.storage.downloadUrl(photoExport.key, filename, 'attachment'),
      expiresIn: this.storage.signedUrlTtl,
    };
  }

  /** Seul le demandeur voit son export : la sélection reflète ses propres droits. */
  private async find(id: string, actor: Actor) {
    const photoExport = await this.prisma.db.photoExport.findUnique({
      where: { id },
      omit: { entries: true },
    });
    if (!photoExport) throw new NotFoundException(NOT_FOUND);
    if (photoExport.requestedById !== actor.userId) {
      throw new ForbiddenException({
        error: 'forbidden',
        message: 'Export d’un autre utilisateur',
      });
    }
    return photoExport;
  }

  private toDto(photoExport: Omit<PhotoExport, 'entries'> & { entries?: unknown }) {
    return {
      id: photoExport.id,
      structureId: photoExport.structureId,
      status: photoExport.status,
      pattern: photoExport.pattern,
      fileCount: photoExport.fileCount,
      size: photoExport.size === null ? null : Number(photoExport.size),
      error: photoExport.error,
      expiresAt: photoExport.expiresAt,
      completedAt: photoExport.completedAt,
      createdAt: photoExport.createdAt,
    };
  }
}
