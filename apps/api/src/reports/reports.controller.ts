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

  @Get('structures/:structureId/reports')
  @Can('structure:read')
  list(@Param('structureId', ParseUUIDPipe) structureId: string) {
    return this.reports.list(structureId);
  }

  @Get('structures/:structureId/reports/tags')
  @Can('report:manage')
  tags(@Param('structureId', ParseUUIDPipe) structureId: string) {
    return this.reports.tags(structureId);
  }

  @Post('structures/:structureId/reports')
  @Can('report:manage')
  create(
    @CurrentInstance() instance: Instance,
    @CurrentActor() actor: Actor,
    @Param('structureId', ParseUUIDPipe) structureId: string,
    @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>,
  ) {
    return this.reports.create(instance, structureId, actor, body);
  }

  @Get('reports/:id')
  @Can('structure:read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.reports.get(id);
  }

  @Patch('reports/:id')
  @Can('report:manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateSchema)) body: z.infer<typeof updateSchema>,
  ) {
    return this.reports.update(id, body);
  }

  @Delete('reports/:id')
  @Can('report:manage')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.reports.remove(id);
  }

  @Get('reports/:id/template')
  @Can('report:manage')
  template(@Param('id', ParseUUIDPipe) id: string) {
    return this.reports.templateUrl(id);
  }

  /** PDF d'une fiche (droits de lecture de la fiche) ou aperçu sur une fiche d'exemple. */
  @Post('reports/:id/render')
  @Can('structure:read')
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
