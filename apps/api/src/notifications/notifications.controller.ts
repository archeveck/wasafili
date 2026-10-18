import { Body, Controller, Delete, Get, HttpCode, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { type Actor, CurrentActor, CurrentInstance } from '../auth/decorators';
import { paginationSchema } from '../common/pagination';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { type Instance } from '../generated/prisma/client';
import { NotificationsService } from './notifications.service';

const listSchema = paginationSchema.extend({ unread: z.stringbool().optional() });
const readSchema = z.object({ ids: z.array(z.uuid()).max(500).optional() });
const tokenSchema = z.object({
  token: z.string().trim().min(1).max(500),
  platform: z.enum(['ios', 'android', 'web']).optional(),
});
const unregisterSchema = z.object({ token: z.string().trim().min(1).max(500) });

/** Centre de notifications de l'appelant et jetons push de ses appareils. */
@Controller(':app')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('notifications')
  list(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(listSchema)) query: z.infer<typeof listSchema>,
  ) {
    return this.notifications.list(actor, query);
  }

  @Post('notifications/read')
  @HttpCode(200)
  read(
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(readSchema)) body: z.infer<typeof readSchema>,
  ) {
    return this.notifications.markRead(actor, body.ids);
  }

  @Post('push-tokens')
  @HttpCode(204)
  register(
    @CurrentInstance() instance: Instance,
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(tokenSchema)) body: z.infer<typeof tokenSchema>,
  ) {
    return this.notifications.registerToken(instance.id, actor, body.token, body.platform);
  }

  @Delete('push-tokens')
  @HttpCode(204)
  unregister(
    @CurrentActor() actor: Actor,
    @Query(new ZodValidationPipe(unregisterSchema)) query: z.infer<typeof unregisterSchema>,
  ) {
    return this.notifications.unregisterToken(actor, query.token);
  }
}
