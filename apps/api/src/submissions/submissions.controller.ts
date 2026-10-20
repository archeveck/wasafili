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
import { Audit } from '../audit/audit.interceptor';
import { OpenApi, SUBMISSION_FILTERS } from '../openapi/openapi.decorator';
import * as resources from '../openapi/resources';

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
const selectionSchema = listSchema.omit({ page: true, per_page: true });
const deleteSchema = z.object({ client_mutation_id: mutationId.optional() });
const resolveSchema = z.object({ resolution: z.enum(['kept', 'restored']) });

const exportSchema = selectionSchema.extend({
  format: z.enum(['csv', 'xlsx', 'pdf']).default('xlsx'),
});

const MIME = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
} as const;

/**
 * Fiches. Les droits sont évalués par structure dans le service (règles de la structure,
 * sinon permissions d'instance du rôle) : pas de `@Can` d'instance ici.
 */
@Controller(':app')
export class SubmissionsController {
  constructor(private readonly submissions: SubmissionsService) {}

  /**
   * Fiches d'un formulaire, paginées. Filtres `filter[cle]=v` ou `filter[cle][op]=v`, tri
   * `sort=cle` ou `sort=-cle` (décroissant), période de création, état, auteur.
   */
  @Get('structures/:structureId/submissions')
  @OpenApi({ page: resources.submission, parameters: [SUBMISSION_FILTERS] })
  list(
    @Param('structureId', ParseUUIDPipe) structureId: string,
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(listSchema)) params: z.infer<typeof listSchema>,
    @Query() query: Record<string, unknown>,
  ) {
    return this.submissions.list(structureId, actor, { ...params, filters: parseFilters(query) });
  }

  /** Nombre de fiches par état de workflow, avec les mêmes filtres que la liste (P4.3). */
  @Get('structures/:structureId/submissions/states')
  @OpenApi({ list: resources.stateCount, parameters: [SUBMISSION_FILTERS] })
  async states(
    @Param('structureId', ParseUUIDPipe) structureId: string,
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(selectionSchema)) params: z.infer<typeof selectionSchema>,
    @Query() query: Record<string, unknown>,
  ) {
    return {
      data: await this.submissions.stateCounts(structureId, actor, {
        ...params,
        filters: parseFilters(query),
      }),
    };
  }

  /** Fiches localisées en GeoJSON, avec les mêmes filtres que la liste (P6.1.1). */
  @Get('structures/:structureId/submissions/map')
  @OpenApi({ parameters: [SUBMISSION_FILTERS] })
  map(
    @Param('structureId', ParseUUIDPipe) structureId: string,
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(selectionSchema)) params: z.infer<typeof selectionSchema>,
    @Query() query: Record<string, unknown>,
  ) {
    return this.submissions.map(structureId, actor, { ...params, filters: parseFilters(query) });
  }

  /**
   * Export CSV, XLSX ou PDF avec les mêmes filtres et le même tri que la liste. Le PDF (tableau
   * mis en page, 2 000 fiches au plus) suit le fuseau de l'instance.
   */
  @Get('structures/:structureId/submissions/export')
  @Audit('submission.export', { type: 'structure', param: 'structureId', query: true })
  @OpenApi({ produces: Object.values(MIME), parameters: [SUBMISSION_FILTERS] })
  async export(
    @CurrentInstance() instance: Instance,
    @Param('structureId', ParseUUIDPipe) structureId: string,
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(exportSchema)) params: z.infer<typeof exportSchema>,
    @Query() query: Record<string, unknown>,
    @Res() res: Response,
  ) {
    const content = await this.submissions.export(
      instance,
      structureId,
      actor,
      { ...params, filters: parseFilters(query) },
      params.format,
    );
    res.status(200).type(MIME[params.format]).attachment(`fiches.${params.format}`).send(content);
  }

  /**
   * Crée une fiche dans la version publiée du formulaire. Avec `clientMutationId`, un rejeu renvoie
   * la fiche existante (200) sans doublon.
   */
  @Post('structures/:structureId/submissions')
  @OpenApi({ response: resources.submission })
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

  /** Détail d'une fiche. */
  @Get('submissions/:id')
  @OpenApi({ response: resources.submission })
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor) {
    return this.submissions.get(id, actor);
  }

  /**
   * Modifie les champs d'une fiche. Seuls les champs envoyés changent ; avec `baseRevision`, un
   * champ modifié entre-temps est enregistré comme conflit.
   */
  @Patch('submissions/:id')
  @OpenApi({ response: resources.submission })
  async update(
    @CurrentInstance() instance: Instance,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(updateSchema)) body: z.infer<typeof updateSchema>,
  ) {
    return (await this.submissions.update(instance, id, actor, body)).submission;
  }

  /** Applique une transition de workflow, avec éventuellement des champs à enregistrer. */
  @Post('submissions/:id/transition')
  @HttpCode(200)
  @OpenApi({ response: resources.submission })
  async transition(
    @CurrentInstance() instance: Instance,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(transitionSchema)) body: z.infer<typeof transitionSchema>,
  ) {
    return (await this.submissions.transition(instance, id, actor, body)).submission;
  }

  /** Supprime une fiche. */
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

  /** Conflits de modification d'une fiche. */
  @Get('submissions/:id/conflicts')
  async conflicts(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor) {
    return { data: await this.submissions.conflicts(id, actor) };
  }

  /** Résout un conflit : garder la valeur appliquée ou restaurer la valeur écrasée. */
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

  /** Automatisations exécutées sur une fiche. */
  @Get('submissions/:id/automation-runs')
  async automationRuns(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor) {
    return { data: await this.submissions.automationRuns(id, actor) };
  }

  /** Historique des révisions d'une fiche (champ par champ). */
  @Get('submissions/:id/revisions')
  @OpenApi({ page: resources.revision })
  revisions(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(paginationSchema)) pagination: z.infer<typeof paginationSchema>,
  ) {
    return this.submissions.revisions(id, actor, pagination);
  }
}
