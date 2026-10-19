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
import { ReportsService } from './reports.service';
import { Audit } from '../audit/audit.interceptor';
import { OpenApi } from '../openapi/openapi.decorator';
import * as resources from '../openapi/resources';

const fields = {
  name: z.string().trim().min(1).max(200),
  fileId: z.uuid(),
  filename: z.string().trim().max(200).nullable().optional(),
};
const createSchema = z.object(fields);
const updateSchema = z
  .object(fields)
  .partial()
  .refine((input) => Object.keys(input).length > 0, { message: 'Aucune modification' });
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

  /** Balises utilisables dans un modèle DOCX pour ce formulaire. */
  @Get('structures/:structureId/reports/tags')
  @Can('report:manage')
  tags(@Param('structureId', ParseUUIDPipe) structureId: string) {
    return this.reports.tags(structureId);
  }

  /** Crée un modèle de rapport à partir d'un fichier DOCX déjà déposé. */
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
