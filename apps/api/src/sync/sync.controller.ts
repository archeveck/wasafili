import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { type Actor, CurrentActor, CurrentInstance } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { type Instance } from '../generated/prisma/client';
import { MAX_PUSH_MUTATIONS, type Mutation, SyncService } from './sync.service';

const id = z.string().trim().min(1).max(100);
const data = z.record(z.string(), z.unknown());
const mutationSchema = z.discriminatedUnion('type', [
  z.object({
    id,
    type: z.literal('create'),
    submissionId: z.uuid(),
    structureId: z.uuid(),
    data,
    location: z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        accuracy: z.number().min(0).optional(),
      })
      .optional(),
    taskId: z.uuid().optional(),
  }),
  z.object({
    id,
    type: z.literal('update'),
    submissionId: z.uuid(),
    baseRevision: z.number().int().min(1).optional(),
    data,
  }),
  z.object({
    id,
    type: z.literal('transition'),
    submissionId: z.uuid(),
    transition: z.string().trim().min(1).max(63),
    baseRevision: z.number().int().min(1).optional(),
    data: data.optional(),
  }),
  z.object({ id, type: z.literal('delete'), submissionId: z.uuid() }),
]);
const pushSchema = z.object({ mutations: z.array(mutationSchema).min(1).max(MAX_PUSH_MUTATIONS) });
const pullSchema = z.object({
  cursor: z.string().max(4000).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

/** Synchronisation hors ligne (P3.2.2, P3.2.3). Les droits sont ceux de l'API classique. */
@Controller(':app/sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  /**
   * Synchronisation mobile : changements depuis un curseur (formulaires, référentiels, fiches,
   * tâches, notifications).
   */
  @Get('pull')
  pull(
    @CurrentInstance() instance: Instance,
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(pullSchema)) query: z.infer<typeof pullSchema>,
  ) {
    return this.sync.pull(instance, actor, query.cursor, query.limit);
  }

  /** Synchronisation mobile : mutations hors ligne idempotentes (`clientMutationId`). */
  @Post('push')
  @HttpCode(200)
  async push(
    @CurrentInstance() instance: Instance,
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(pushSchema)) body: z.infer<typeof pushSchema>,
  ) {
    return { results: await this.sync.push(instance, actor, body.mutations as Mutation[]) };
  }
}
