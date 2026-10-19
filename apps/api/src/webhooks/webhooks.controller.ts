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
import { Audit } from '../audit/audit.interceptor';
import { OpenApi } from '../openapi/openapi.decorator';
import * as resources from '../openapi/resources';

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

  /** Webhooks sortants de l'instance. */
  @Get()
  @Can('automation:manage')
  @OpenApi({ list: resources.webhook })
  list() {
    return this.webhooks.list();
  }

  /** Événements auxquels un webhook peut s'abonner. */
  @Get('events')
  @Can('automation:manage')
  events() {
    return { data: WEBHOOK_EVENTS };
  }

  /** Crée un webhook ; le secret de signature n'est renvoyé qu'ici. */
  @Post()
  @Audit('webhook.create')
  @Can('automation:manage')
  @OpenApi({ response: resources.webhook })
  create(
    @CurrentInstance() instance: Instance,
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>,
  ) {
    return this.webhooks.create(instance.id, actor, body);
  }

  /** Détail d'un webhook. */
  @Get(':id')
  @Can('automation:manage')
  @OpenApi({ response: resources.webhook })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.webhooks.get(id);
  }

  /** Modifie un webhook (URL, événements, activation). */
  @Patch(':id')
  @Audit('webhook.update')
  @Can('automation:manage')
  @OpenApi({ response: resources.webhook })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateSchema)) body: z.infer<typeof updateSchema>,
  ) {
    return this.webhooks.update(id, body);
  }

  /** Supprime un webhook. */
  @Delete(':id')
  @Audit('webhook.delete')
  @Can('automation:manage')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.webhooks.remove(id);
  }

  /** Remplace le secret de signature ; le nouveau secret n'est renvoyé qu'ici. */
  @Post(':id/secret')
  @Audit('webhook.secret')
  @Can('automation:manage')
  @OpenApi({ response: resources.webhook })
  rotate(@Param('id', ParseUUIDPipe) id: string) {
    return this.webhooks.rotateSecret(id);
  }

  /** Envoie un événement de test. */
  @Post(':id/ping')
  @Can('automation:manage')
  ping(@CurrentInstance() instance: Instance, @Param('id', ParseUUIDPipe) id: string) {
    return this.webhooks.ping(instance.id, id);
  }

  /** Livraisons d'un webhook (journal). */
  @Get(':id/deliveries')
  @Can('automation:manage')
  @OpenApi({ page: resources.webhookDelivery })
  deliveries(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(paginationSchema)) query: z.infer<typeof paginationSchema>,
  ) {
    return this.webhooks.deliveries(id, query);
  }

  /** Relance une livraison. */
  @Post(':id/deliveries/:deliveryId/retry')
  @Audit('webhook_delivery.retry', { param: 'deliveryId' })
  @Can('automation:manage')
  redeliver(
    @CurrentInstance() instance: Instance,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('deliveryId', ParseUUIDPipe) deliveryId: string,
  ) {
    return this.webhooks.redeliver(instance.id, id, deliveryId);
  }
}
