import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { type Actor, Can, CurrentActor, CurrentInstance } from '../auth/decorators';
import { paginationSchema } from '../common/pagination';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { type Instance } from '../generated/prisma/client';
import { automationSchema } from './automation-schema';
import { AutomationsService } from './automations.service';

const listSchema = z.object({ structure_id: z.uuid().optional() });
const runsSchema = paginationSchema.extend({
  automation_id: z.uuid().optional(),
  submission_id: z.uuid().optional(),
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'skipped']).optional(),
});

/** Automatisations (P5.3) et journal d'exécution (P5.3.5). */
@Controller(':app')
export class AutomationsController {
  constructor(private readonly automations: AutomationsService) {}

  @Get('automations')
  @Can('automation:manage')
  list(@Query(new ZodValidationPipe(listSchema)) query: z.infer<typeof listSchema>) {
    return this.automations.list(query.structure_id);
  }

  @Post('automations')
  @Can('automation:manage')
  create(
    @CurrentInstance() instance: Instance,
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(automationSchema)) body: z.infer<typeof automationSchema>,
  ) {
    return this.automations.create(instance, actor, body);
  }

  @Get('automations/:id')
  @Can('automation:manage')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.automations.get(id);
  }

  @Put('automations/:id')
  @Can('automation:manage')
  update(
    @CurrentInstance() instance: Instance,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(automationSchema)) body: z.infer<typeof automationSchema>,
  ) {
    return this.automations.update(instance, id, body);
  }

  @Delete('automations/:id')
  @Can('automation:manage')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.automations.remove(id);
  }

  @Get('automation-runs')
  @Can('automation:manage')
  runs(@Query(new ZodValidationPipe(runsSchema)) query: z.infer<typeof runsSchema>) {
    return this.automations.runs(query);
  }

  @Post('automation-runs/:id/retry')
  @Can('automation:manage')
  retry(@Param('id', ParseUUIDPipe) id: string) {
    return this.automations.retry(id);
  }
}
