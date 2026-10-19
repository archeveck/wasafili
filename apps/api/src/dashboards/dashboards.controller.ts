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
} from '@nestjs/common';
import { z } from 'zod';
import { Audit } from '../audit/audit.interceptor';
import { type Actor, Can, CurrentActor, CurrentInstance } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { type Instance } from '../generated/prisma/client';
import { DashboardsService } from './dashboards.service';
import { dashboardSchema, widgetSchema } from './widgets';

/**
 * Tableaux de bord (P6.2) : `/{app}/dashboards`. Tout membre les consulte ; les chiffres
 * suivent ses droits sur les fiches. `dashboard:manage` pour les créer et les modifier.
 */
@Controller(':app/dashboards')
export class DashboardsController {
  constructor(private readonly dashboards: DashboardsService) {}

  @Get()
  list() {
    return this.dashboards.list();
  }

  /** Valeurs d'un widget, enregistré ou en cours d'édition (aperçu). */
  @Post('widget-data')
  @HttpCode(200)
  data(
    @CurrentInstance() instance: Instance,
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(widgetSchema)) widget: z.infer<typeof widgetSchema>,
  ) {
    return this.dashboards.data(instance, actor, widget);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.dashboards.get(id);
  }

  @Post()
  @Audit('dashboard.create')
  @Can('dashboard:manage')
  create(
    @CurrentInstance() instance: Instance,
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(dashboardSchema)) body: z.infer<typeof dashboardSchema>,
  ) {
    return this.dashboards.create(instance.id, actor, body);
  }

  @Put(':id')
  @Audit('dashboard.update')
  @Can('dashboard:manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(dashboardSchema)) body: z.infer<typeof dashboardSchema>,
  ) {
    return this.dashboards.update(id, body);
  }

  @Delete(':id')
  @Audit('dashboard.delete')
  @Can('dashboard:manage')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.dashboards.remove(id);
  }
}
