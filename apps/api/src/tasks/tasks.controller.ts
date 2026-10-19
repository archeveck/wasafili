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
} from '@nestjs/common';
import { z } from 'zod';
import { type Actor, CanAny, CurrentActor, CurrentInstance, Can } from '../auth/decorators';
import { paginationSchema } from '../common/pagination';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { type Instance } from '../generated/prisma/client';
import { TASK_STATUSES, TasksService } from './tasks.service';
import { OpenApi } from '../openapi/openapi.decorator';
import * as resources from '../openapi/resources';

const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();
const fields = {
  title: z.string().trim().min(1).max(200),
  description: nullableText(5000),
  assigneeUserId: z.uuid().nullable().optional(),
  assigneeGroupId: z.uuid().nullable().optional(),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  dueAt: z.coerce.date().nullable().optional(),
  locationLabel: nullableText(300),
  location: z
    .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
    .nullable()
    .optional(),
  prefill: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(TASK_STATUSES).optional(),
};
const createSchema = z.object({ id: z.uuid().optional(), structureId: z.uuid(), ...fields });
const updateSchema = z
  .object(fields)
  .partial()
  .refine((input) => Object.keys(input).length > 0, { message: 'Aucune modification' });
const listSchema = paginationSchema.extend({
  per_page: z.coerce.number().int().min(1).max(500).default(100),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  structure_id: z.uuid().optional(),
  assignee_user_id: z.uuid().optional(),
  assignee_group_id: z.uuid().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  mine: z.stringbool().optional(),
});

/** Tâches planifiées (agenda). */
@Controller(':app/tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  /** Tâches, filtrables par période, formulaire, assigné et statut. */
  @Get()
  @CanAny('task:read', 'task:manage')
  @OpenApi({ page: resources.task })
  list(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(listSchema)) query: z.infer<typeof listSchema>,
  ) {
    return this.tasks.list(actor, query);
  }

  /** Détail d'une tâche. */
  @Get(':id')
  @CanAny('task:read', 'task:manage')
  @OpenApi({ response: resources.task })
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor) {
    return this.tasks.get(id, actor);
  }

  /** Crée une tâche : une fiche à saisir, assignée à un membre ou un groupe. */
  @Post()
  @Can('task:manage')
  @OpenApi({ response: resources.task })
  create(
    @CurrentInstance() instance: Instance,
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>,
  ) {
    return this.tasks.create(instance, actor, body);
  }

  /** Modifie une tâche. */
  @Patch(':id')
  @Can('task:manage')
  @OpenApi({ response: resources.task })
  update(
    @CurrentInstance() instance: Instance,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(updateSchema)) body: z.infer<typeof updateSchema>,
  ) {
    return this.tasks.update(instance, id, actor, body);
  }

  /** Supprime une tâche. */
  @Delete(':id')
  @Can('task:manage')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor) {
    return this.tasks.remove(id, actor);
  }
}
