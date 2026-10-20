import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { type Actor, Can, CurrentActor, CurrentInstance } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { type Instance } from '../generated/prisma/client';
import { HTML_TEMPLATE_MAX_LENGTH } from './html';
import { ReportsService } from './reports.service';
import { Audit } from '../audit/audit.interceptor';
import { OpenApi } from '../openapi/openapi.decorator';
import * as resources from '../openapi/resources';

const fields = {
  name: z.string().trim().min(1).max(200),
  /** Modèle DOCX : fichier déjà déposé. */
  fileId: z.uuid(),
  /** Modèle HTML, mêmes balises que le DOCX ; ni script ni ressource externe. */
  html: z.string().min(1).max(HTML_TEMPLATE_MAX_LENGTH),
  filename: z.string().trim().max(200).nullable().optional(),
};
const oneSource = (input: { fileId?: unknown; html?: unknown }) =>
  input.fileId === undefined || input.html === undefined;
const createSchema = z
  .object({ ...fields, fileId: fields.fileId.optional(), html: fields.html.optional() })
  .refine((input) => oneSource(input) && (input.fileId ?? input.html) !== undefined, {
    message: 'Un modèle est soit un fichier DOCX (fileId), soit du HTML (html)',
    path: ['fileId'],
  });
const updateSchema = z
  .object(fields)
  .partial()
  .refine((input) => Object.keys(input).length > 0, { message: 'Aucune modification' })
  .refine(oneSource, { message: 'fileId ou html, pas les deux', path: ['html'] });
const renderSchema = z.object({ submissionId: z.uuid().optional() });

/** Modèles de rapports (P5.1) et génération PDF. */
@Controller(':app')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** Modèles de rapport d'un formulaire. */
  @Get('structures/:structureId/reports')
  @Can('structure:read')
  @OpenApi({ list: resources.reportTemplate })
  list(@Param('structureId', ParseUUIDPipe) structureId: string) {
    return this.reports.list(structureId);
  }

  /** Balises utilisables dans un modèle (DOCX ou HTML) pour ce formulaire. */
  @Get('structures/:structureId/reports/tags')
  @Can('report:manage')
  tags(@Param('structureId', ParseUUIDPipe) structureId: string) {
    return this.reports.tags(structureId);
  }

  /** Crée un modèle de rapport : fichier DOCX déjà déposé, ou HTML (stocké tel quel). */
  @Post('structures/:structureId/reports')
  @Audit('report.create')
  @Can('report:manage')
  @OpenApi({ response: resources.reportTemplate })
  create(
    @CurrentInstance() instance: Instance,
    @CurrentActor() actor: Actor,
    @Param('structureId', ParseUUIDPipe) structureId: string,
    @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>,
  ) {
    return this.reports.create(instance, structureId, actor, body);
  }

  /** Détail d'un modèle de rapport. */
  @Get('reports/:id')
  @Can('structure:read')
  @OpenApi({ response: resources.reportTemplate })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.reports.get(id);
  }

  /** Modifie un modèle de rapport (nom, fichier DOCX, nom du PDF). */
  @Patch('reports/:id')
  @Audit('report.update')
  @Can('report:manage')
  @OpenApi({ response: resources.reportTemplate })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateSchema)) body: z.infer<typeof updateSchema>,
  ) {
    return this.reports.update(id, body);
  }

  /** Supprime un modèle de rapport. */
  @Delete('reports/:id')
  @Audit('report.delete')
  @Can('report:manage')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.reports.remove(id);
  }

  /** Télécharge le fichier DOCX d'un modèle de rapport. */
  @Get('reports/:id/template')
  @Can('report:manage')
  template(@Param('id', ParseUUIDPipe) id: string) {
    return this.reports.templateUrl(id);
  }

  /** PDF d'une fiche (droits de lecture de la fiche) ou aperçu sur une fiche d'exemple. */
  @Post('reports/:id/render')
  @Audit('report.render')
  @Can('structure:read')
  @OpenApi({ response: resources.renderedReport })
  async render(
    @CurrentInstance() instance: Instance,
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(renderSchema)) body: z.infer<typeof renderSchema>,
  ) {
    const { url, filename, cached } = await this.reports.render(
      instance,
      id,
      actor,
      body.submissionId,
    );
    return { url, filename, cached };
  }
}
