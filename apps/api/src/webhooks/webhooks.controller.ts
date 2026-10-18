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
import { type Actor, Can, CurrentActor, CurrentInstance } from '../auth/decorators';
import { paginationSchema } from '../common/pagination';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { type Instance } from '../generated/prisma/client';
import { WEBHOOK_EVENTS, WebhooksService } from './webhooks.service';

const fields = {
  name: z.string().trim().min(1).max(200),
  url: z.url({ protocol: /^https?$/, message: 'URL http(s) attendue' }).max(2000),
  events: z.array(z.enum(WEBHOOK_EVENTS)).max(WEBHOOK_EVENTS.length),
  structureId: z.uuid().nullable().optional(),
};
const createSchema = z.object(fields);
const updateSchema = z
  .object({ ...fields, enabled: z.boolean() })
  .partial()
  .refine((input) => Object.keys(input).length > 0, { message: 'Aucune modification' });

/** Webhooks sortants (P5.4) : `/{app}/webhooks`. */
@Controller(':app/webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  @Can('automation:manage')
  list() {
    return this.webhooks.list();
  }

  @Get('events')
  @Can('automation:manage')
  events() {
    return { data: WEBHOOK_EVENTS };
  }

  @Post()
  @Can('automation:manage')
  create(
    @CurrentInstance() instance: Instance,
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>,
  ) {
    return this.webhooks.create(instance.id, actor, body);
  }

  @Get(':id')
  @Can('automation:manage')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.webhooks.get(id);
  }

  @Patch(':id')
  @Can('automation:manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateSchema)) body: z.infer<typeof updateSchema>,
  ) {
    return this.webhooks.update(id, body);
  }

  @Delete(':id')
  @Can('automation:manage')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.webhooks.remove(id);
  }

  @Post(':id/secret')
  @Can('automation:manage')
  rotate(@Param('id', ParseUUIDPipe) id: string) {
    return this.webhooks.rotateSecret(id);
  }

  @Post(':id/ping')
  @Can('automation:manage')
  ping(@CurrentInstance() instance: Instance, @Param('id', ParseUUIDPipe) id: string) {
    return this.webhooks.ping(instance.id, id);
  }

  @Get(':id/deliveries')
  @Can('automation:manage')
  deliveries(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(paginationSchema)) query: z.infer<typeof paginationSchema>,
  ) {
    return this.webhooks.deliveries(id, query);
  }

  @Post(':id/deliveries/:deliveryId/retry')
  @Can('automation:manage')
  redeliver(
    @CurrentInstance() instance: Instance,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('deliveryId', ParseUUIDPipe) deliveryId: string,
  ) {
    return this.webhooks.redeliver(instance.id, id, deliveryId);
  }
}
