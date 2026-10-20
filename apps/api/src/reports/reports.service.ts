import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { type StructureDefinition, type SubmissionData, walkFields } from '@wasafili/form-schema';
import { type Actor } from '../auth/decorators';
import { type Instance, Prisma, type ReportTemplate } from '../generated/prisma/client';
import { StorageService } from '../files/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { StructuresService } from '../structures/structures.service';
import { SubmissionsService } from '../submissions/submissions.service';
import { solidPng } from './build-docx';
import {
  type ImageFile,
  inspectTemplate,
  renderTemplate,
  renderText,
  TemplateSyntaxError,
  type TemplateTag,
} from './docx';
import { GotenbergClient } from './gotenberg';
import {
  availableTags,
  checkTags,
  imageFileIds,
  reportData,
  SAMPLE_IMAGE,
  sampleSubmission,
  type SubmissionInfo,
} from './report-data';

const NOT_FOUND = { error: 'not_found', message: 'Modèle de rapport introuvable' };
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_TEMPLATE_BYTES = 10 * 1024 * 1024;

export interface ReportInput {
  name: string;
  fileId: string;
  filename?: string | null;
}

export interface RenderedReport {
  url: string;
  filename: string;
  /** Clé du PDF dans le stockage (pièce jointe d'un e-mail). */
  key: string;
  cached: boolean;
}

function safeFilename(name: string): string {
  const cleaned = name
    .replace(/[\\/:]+/g, '-')
    .replace(/[*?"<>|]+/g, ' ')
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150);
  return `${cleaned || 'rapport'}.pdf`;
}

/**
 * Rapports (P5.1) : modèles DOCX par structure, fusion avec une fiche puis conversion PDF.
 * Le PDF est mis en cache par révision de fiche et par version du modèle : regénérer une fiche
 * inchangée ne relance pas la conversion.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly structures: StructuresService,
    private readonly submissions: SubmissionsService,
    private readonly storage: StorageService,
    private readonly gotenberg: GotenbergClient,
  ) {}

  async list(structureId: string) {
    await this.structures.get(structureId);
    const [templates, definition] = await Promise.all([
      this.prisma.db.reportTemplate.findMany({
        where: { structureId },
        orderBy: { name: 'asc' },
        include: { file: { select: { name: true, size: true } } },
      }),
      this.definition(structureId),
    ]);
    return { data: templates.map((t) => this.toDto(t, definition)) };
  }

  async get(id: string) {
    const template = await this.find(id);
    return this.toDto(template, await this.definition(template.structureId));
  }

  /** Balises proposées pour la structure (aide à la rédaction du modèle). */
  async tags(structureId: string) {
    await this.structures.get(structureId);
    const definition = await this.definition(structureId);
    return availableTags(definition ?? ({ schemaVersion: 1, fields: [] } as StructureDefinition));
  }

  async create(instance: Instance, structureId: string, actor: Actor, input: ReportInput) {
    await this.structures.get(structureId);
    const tags = await this.analyze(input.fileId);
    const created = await this.prisma.db.reportTemplate.create({
      data: {
        instanceId: instance.id,
        structureId,
        name: input.name,
        fileId: input.fileId,
        filename: input.filename ?? null,
        tags: tags as unknown as Prisma.InputJsonValue,
        createdById: actor.userId,
      },
    });
    return this.get(created.id);
  }

  async update(id: string, input: Partial<ReportInput>) {
    await this.find(id);
    const tags = input.fileId ? await this.analyze(input.fileId) : undefined;
    await this.prisma.db.reportTemplate.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.filename !== undefined ? { filename: input.filename } : {}),
        ...(input.fileId ? { fileId: input.fileId } : {}),
        ...(tags ? { tags: tags as unknown as Prisma.InputJsonValue } : {}),
      },
    });
    return this.get(id);
  }

  /** Suppression refusée tant qu'une automatisation joint ce rapport à ses e-mails. */
  async remove(id: string) {
    await this.find(id);
    const automations = await this.prisma.db.automation.findMany({
      where: { deletedAt: null },
      select: { name: true, actions: true },
    });
    const users = automations.filter((a) =>
      (a.actions as { reportId?: string }[]).some((action) => action.reportId === id),
    );
    if (users.length > 0) {
      throw new ConflictException({
        error: 'report_in_use',
        message: `Rapport utilisé par : ${users.map((a) => a.name).join(', ')}`,
      });
    }
    await this.prisma.db.reportTemplate.delete({ where: { id } });
  }

  async templateUrl(id: string) {
    const template = await this.find(id);
    const file = await this.prisma.db.file.findUniqueOrThrow({ where: { id: template.fileId } });
    return { url: await this.storage.downloadUrl(file.key, file.name) };
  }

  /**
   * Génère le PDF d'une fiche visible par l'appelant, ou d'une fiche d'exemple (aperçu,
   * réservé aux gestionnaires des rapports).
   */
  async render(instance: Instance, id: string, actor: Actor, submissionId?: string) {
    const template = await this.find(id);
    if (!submissionId) {
      if (!actor.permissions.has('report:manage')) {
        throw new ForbiddenException({
          error: 'forbidden',
          message: 'Aperçu réservé à la gestion des rapports',
        });
      }
      return this.renderSample(instance, template);
    }
    const visible = await this.submissions.get(submissionId, actor);
    if (visible.structureId !== template.structureId) {
      throw new UnprocessableEntityException({
        error: 'invalid_report',
        message: 'Ce modèle ne concerne pas le formulaire de cette fiche',
      });
    }
    return this.renderSubmission(instance, template.id, submissionId);
  }

  /** Génération sans contrôle d'appelant (automatisations) ; mise en cache par révision. */
  async renderSubmission(
    instance: Instance,
    id: string,
    submissionId: string,
  ): Promise<RenderedReport> {
    const template = await this.find(id);
    const submission = await this.prisma.db.submission.findFirst({
      where: { id: submissionId, deletedAt: null },
      include: { version: true },
    });
    if (!submission)
      throw new NotFoundException({ error: 'not_found', message: 'Fiche introuvable' });
    const definition = submission.version.definition as StructureDefinition;
    const info: SubmissionInfo = {
      id: submission.id,
      state: submission.state,
      authorId: submission.authorId,
      createdAt: submission.createdAt,
      updatedAt: submission.updatedAt,
      data: submission.data as SubmissionData,
    };
    const key = `${instance.id}/reports/${template.id}/${template.fileId}/${submission.id}-r${submission.revision}.pdf`;
    return this.produce(instance, template, definition, info, key);
  }

  /** Données de fusion d'une fiche (balises des sujets et corps d'e-mails, titres de tâches). */
  async mergeData(instance: Instance, submissionId: string) {
    const submission = await this.prisma.db.submission.findFirst({
      where: { id: submissionId },
      include: { version: true, structure: { select: { name: true } } },
    });
    if (!submission)
      throw new NotFoundException({ error: 'not_found', message: 'Fiche introuvable' });
    const definition = submission.version.definition as StructureDefinition;
    const info: SubmissionInfo = {
      id: submission.id,
      state: submission.state,
      authorId: submission.authorId,
      createdAt: submission.createdAt,
      updatedAt: submission.updatedAt,
      data: submission.data as SubmissionData,
    };
    return reportData(definition, info, {
      structureName: submission.structure.name,
      instanceName: instance.name,
      timeZone: instance.timeZone,
      labels: await this.labels(definition, info),
    });
  }

  private async renderSample(instance: Instance, template: ReportTemplate) {
    const definition = await this.definition(template.structureId);
    if (!definition) {
      throw new ConflictException({
        error: 'no_published_version',
        message: "La structure n'a pas de version publiée",
      });
    }
    const key = `${instance.id}/reports/${template.id}/${template.fileId}/exemple.pdf`;
    return this.produce(instance, template, definition, sampleSubmission(definition), key, true);
  }

  private async produce(
    instance: Instance,
    template: ReportTemplate,
    definition: StructureDefinition,
    submission: SubmissionInfo,
    key: string,
    sample = false,
  ): Promise<RenderedReport> {
    const structure = await this.prisma.db.structure.findUniqueOrThrow({
      where: { id: template.structureId },
      select: { name: true },
    });
    const data = reportData(definition, submission, {
      structureName: structure.name,
      instanceName: instance.name,
      timeZone: instance.timeZone,
      labels: await this.labels(definition, submission),
    });
    const filename = safeFilename(renderText(template.filename ?? template.name, data));
    if (!sample && (await this.storage.head(key))) {
      return { url: await this.storage.downloadUrl(key, filename), filename, key, cached: true };
    }

    const file = await this.prisma.db.file.findUniqueOrThrow({ where: { id: template.fileId } });
    const docx = await this.storage.get(file.key);
    const tags = template.tags as unknown as TemplateTag[];
    const images = await this.images(imageFileIds(data, tags));
    let merged: Buffer;
    try {
      merged = renderTemplate(docx, data, images);
    } catch (error) {
      if (error instanceof TemplateSyntaxError) throw this.invalidTemplate(error);
      throw error;
    }
    await this.storage.put(key, await this.gotenberg.convert(merged), 'application/pdf');
    return { url: await this.storage.downloadUrl(key, filename), filename, key, cached: false };
  }

  /** Libellés des référentiels et utilisateurs cités par la fiche (tableaux compris). */
  private async labels(definition: StructureDefinition, submission: SubmissionInfo) {
    const items = new Set<string>();
    const users = new Set<string>(submission.authorId ? [submission.authorId] : []);
    const collect = (type: string, value: unknown) => {
      if (value === null || value === undefined) return;
      if (type === 'list') items.add(String(value));
      if (type === 'user' || type === 'author') {
        for (const id of Array.isArray(value) ? value : [value]) users.add(String(id));
      }
    };
    for (const { field, table } of walkFields(definition.fields)) {
      if (table) {
        const rows = submission.data[table.key];
        if (Array.isArray(rows))
          for (const row of rows) collect(field.type, (row as SubmissionData)[field.key]);
      } else collect(field.type, submission.data[field.key]);
    }
    const uuid = (id: string) => /^[0-9a-f-]{36}$/i.test(id);
    const [listItems, people] = await Promise.all([
      this.prisma.db.listItem.findMany({
        where: { id: { in: [...items].filter(uuid) } },
        select: { id: true, label: true },
      }),
      this.prisma.db.user.findMany({
        where: { id: { in: [...users].filter(uuid) } },
        select: { id: true, firstName: true, lastName: true },
      }),
    ]);
    return {
      items: new Map(listItems.map((i) => [i.id, i.label])),
      users: new Map(people.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()])),
    };
  }

  private async images(fileIds: string[]): Promise<Map<string, ImageFile>> {
    const images = new Map<string, ImageFile>();
    if (fileIds.includes(SAMPLE_IMAGE)) {
      images.set(SAMPLE_IMAGE, {
        data: solidPng(400, 300, [203, 213, 225]),
        mimeType: 'image/png',
      });
    }
    const files = await this.prisma.db.file.findMany({
      where: { id: { in: fileIds.filter((id) => id !== SAMPLE_IMAGE) }, status: 'uploaded' },
    });
    await Promise.all(
      files.map(async (file) => {
        images.set(file.id, { data: await this.storage.get(file.key), mimeType: file.mimeType });
      }),
    );
    return images;
  }

  /** Vérifie le fichier téléversé (DOCX, taille) et en extrait les balises. */
  private async analyze(fileId: string): Promise<TemplateTag[]> {
    const file = await this.prisma.db.file.findUnique({ where: { id: fileId } });
    if (!file || file.status !== 'uploaded') {
      throw new UnprocessableEntityException({
        error: 'invalid_report',
        message: 'Fichier du modèle introuvable ou non téléversé',
      });
    }
    if (file.mimeType !== DOCX_MIME && !file.name.toLowerCase().endsWith('.docx')) {
      throw new UnprocessableEntityException({
        error: 'invalid_report',
        message: 'Le modèle doit être un document Word (.docx)',
      });
    }
    if (file.size > MAX_TEMPLATE_BYTES) {
      throw new UnprocessableEntityException({
        error: 'invalid_report',
        message: 'Modèle trop volumineux (10 Mo au plus)',
      });
    }
    try {
      return inspectTemplate(await this.storage.get(file.key));
    } catch (error) {
      if (error instanceof TemplateSyntaxError) throw this.invalidTemplate(error);
      throw error;
    }
  }

  private invalidTemplate(error: TemplateSyntaxError) {
    return new UnprocessableEntityException({
      error: 'invalid_template',
      message: `Modèle invalide : ${error.problems.join(' ; ')}`,
      details: error.problems.map((message) => ({ message })),
    });
  }

  private async find(id: string) {
    const template = await this.prisma.db.reportTemplate.findUnique({
      where: { id },
      include: { file: { select: { name: true, size: true } } },
    });
    if (!template) throw new NotFoundException(NOT_FOUND);
    return template;
  }

  private async definition(structureId: string) {
    const version = await this.structures.currentVersion(structureId);
    return version?.definition as StructureDefinition | undefined;
  }

  private toDto(
    template: ReportTemplate & { file?: { name: string; size: number } },
    definition: StructureDefinition | undefined,
  ) {
    const tags = template.tags as unknown as TemplateTag[];
    return {
      id: template.id,
      structureId: template.structureId,
      name: template.name,
      fileId: template.fileId,
      fileName: template.file?.name ?? null,
      filename: template.filename,
      tags,
      // Recalculées à chaque lecture : la structure a pu évoluer depuis l'envoi du modèle.
      issues: definition ? checkTags(tags, definition) : [],
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    };
  }
}
