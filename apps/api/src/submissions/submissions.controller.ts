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
  Query,
  Res,
} from '@nestjs/common';
import { type Response } from 'express';
import { z } from 'zod';
import { type Actor, CurrentActor, CurrentInstance } from '../auth/decorators';
import { paginationSchema } from '../common/pagination';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { type Instance } from '../generated/prisma/client';
import { parseFilters } from './query';
import { SubmissionsService } from './submissions.service';

const mutationId = z.string().trim().min(1).max(100);
const createSchema = z.object({
  /** UUID généré par le client (fiche créée hors ligne). */
  id: z.uuid().optional(),
  data: z.record(z.string(), z.unknown()),
  clientMutationId: mutationId.optional(),
  taskId: z.uuid().optional(),
  location: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      accuracy: z.number().min(0).optional(),
    })
    .optional(),
});
const updateSchema = z.object({
  data: z.record(z.string(), z.unknown()),
  clientMutationId: mutationId.optional(),
  baseRevision: z.number().int().min(1).optional(),
});
const transitionSchema = z.object({
  transition: z.string().trim().min(1).max(63),
  data: z.record(z.string(), z.unknown()).optional(),
  clientMutationId: mutationId.optional(),
  baseRevision: z.number().int().min(1).optional(),
});
const listSchema = paginationSchema.extend({
  sort: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  author_id: z.uuid().optional(),
  /** Période de création (ISO 8601) : calendrier des fiches. */
  created_from: z.coerce.date().optional(),
  created_to: z.coerce.date().optional(),
});
const deleteSchema = z.object({ client_mutation_id: mutationId.optional() });
const resolveSchema = z.object({ resolution: z.enum(['kept', 'restored']) });

const exportSchema = listSchema.omit({ page: true, per_page: true }).extend({
  format: z.enum(['csv', 'xlsx']).default('xlsx'),
});

const MIME = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;

/**
 * Fiches. Les droits sont évalués par structure dans le service (règles de la structure,
 * sinon permissions d'instance du rôle) : pas de `@Can` d'instance ici.
 */
@Controller(':app')
export class SubmissionsController {
  constructor(private readonly submissions: SubmissionsService) {}

  /** `?filter[cle]=v`, `?filter[cle][gte]=v`, `?sort=-cle`, pagination. */
  @Get('structures/:structureId/submissions')
  list(
    @Param('structureId', ParseUUIDPipe) structureId: string,
    @CurrentActor() actor: Actor,
    @Query() query: Record<string, unknown>,
  ) {
    const params = new ZodValidationPipe(listSchema).transform(query);
    return this.submissions.list(structureId, actor, { ...params, filters: parseFilters(query) });
  }

  /** Nombre de fiches par état de workflow, avec les mêmes filtres que la liste (P4.3). */
  @Get('structures/:structureId/submissions/states')
  async states(
    @Param('structureId', ParseUUIDPipe) structureId: string,
    @CurrentActor() actor: Actor,
    @Query() query: Record<string, unknown>,
  ) {
    const params = new ZodValidationPipe(listSchema.omit({ page: true, per_page: true })).transform(
      query,
    );
    return {
      data: await this.submissions.stateCounts(structureId, actor, {
        ...params,
        filters: parseFilters(query),
      }),
    };
  }

  /** Export CSV/XLSX avec les mêmes filtres que la liste. */
  @Get('structures/:structureId/submissions/export')
  async export(
    @Param('structureId', ParseUUIDPipe) structureId: string,
    @CurrentActor() actor: Actor,
    @Query() query: Record<string, unknown>,
    @Res() res: Response,
  ) {
    const params = new ZodValidationPipe(exportSchema).transform(query);
    const content = await this.submissions.export(
      structureId,
      actor,
      { ...params, filters: parseFilters(query) },
      params.format,
    );
    res.status(200).type(MIME[params.format]).attachment(`fiches.${params.format}`).send(content);
  }

  @Post('structures/:structureId/submissions')
  async create(
    @CurrentInstance() instance: Instance,
    @Param('structureId', ParseUUIDPipe) structureId: string,
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.submissions.create(instance, structureId, actor, body);
    // Rejeu d'une mutation déjà appliquée : 200 et l'état courant, sans doublon.
    res.status(result.replayed ? 200 : 201);
    return result.submission;
  }

  @Get('submissions/:id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor) {
    return this.submissions.get(id, actor);
  }

  @Patch('submissions/:id')
  async update(
    @CurrentInstance() instance: Instance,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(updateSchema)) body: z.infer<typeof updateSchema>,
  ) {
    return (await this.submissions.update(instance, id, actor, body)).submission;
  }

  @Post('submissions/:id/transition')
  @HttpCode(200)
  async transition(
    @CurrentInstance() instance: Instance,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(transitionSchema)) body: z.infer<typeof transitionSchema>,
  ) {
    return (await this.submissions.transition(instance, id, actor, body)).submission;
  }

  @Delete('submissions/:id')
  @HttpCode(204)
  remove(
    @CurrentInstance() instance: Instance,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(deleteSchema)) query: z.infer<typeof deleteSchema>,
  ) {
    return this.submissions.remove(instance, id, actor, query.client_mutation_id);
  }

  @Get('submissions/:id/conflicts')
  async conflicts(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor) {
    return { data: await this.submissions.conflicts(id, actor) };
  }

  @Post('submissions/:id/conflicts/:conflictId/resolve')
  @HttpCode(200)
  resolveConflict(
    @CurrentInstance() instance: Instance,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('conflictId', ParseUUIDPipe) conflictId: string,
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(resolveSchema)) body: z.infer<typeof resolveSchema>,
  ) {
    return this.submissions.resolveConflict(instance, id, conflictId, actor, body.resolution);
  }

  @Get('submissions/:id/revisions')
  revisions(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(paginationSchema)) pagination: z.infer<typeof paginationSchema>,
  ) {
    return this.submissions.revisions(id, actor, pagination);
  }
}
