import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Audit } from '../audit/audit.interceptor';
import { type Actor, CurrentActor, CurrentInstance } from '../auth/decorators';
import { paginationSchema } from '../common/pagination';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { type Instance } from '../generated/prisma/client';
import { FILTER_OPERATORS } from '../submissions/query';
import { PhotoExportsService } from './photo-exports.service';

const createSchema = z.object({
  pattern: z.string().max(300).optional(),
  filters: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(100),
        operator: z.enum(FILTER_OPERATORS),
        value: z.string().max(500),
      }),
    )
    .max(20)
    .default([]),
  sort: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  author_id: z.uuid().optional(),
  created_from: z.coerce.date().optional(),
  created_to: z.coerce.date().optional(),
});

/**
 * Export ZIP des photos (P6.4). Les droits sont ceux de l'export des fiches de la structure
 * (évalués dans le service) ; un export n'est visible que de son demandeur.
 */
@Controller(':app')
export class PhotoExportsController {
  constructor(private readonly exports: PhotoExportsService) {}

  @Post('structures/:structureId/photo-exports')
  @Audit('submission.photos_export', { type: 'structure', param: 'structureId' })
  create(
    @CurrentInstance() instance: Instance,
    @Param('structureId', ParseUUIDPipe) structureId: string,
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>,
  ) {
    return this.exports.create(instance, structureId, actor, body);
  }

  @Get('photo-exports')
  list(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(paginationSchema)) query: z.infer<typeof paginationSchema>,
  ) {
    return this.exports.list(actor, query);
  }

  @Get('photo-exports/:id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor) {
    return this.exports.get(id, actor);
  }

  /** URL signée de courte durée vers l'archive. */
  @Post('photo-exports/:id/download')
  @Audit('photo_export.download')
  download(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor) {
    return this.exports.download(id, actor);
  }
}
