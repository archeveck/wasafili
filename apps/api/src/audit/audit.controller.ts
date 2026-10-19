import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { Can } from '../auth/decorators';
import { paginationSchema } from '../common/pagination';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AUDIT_ACTIONS, AuditService } from './audit.service';

const listSchema = paginationSchema.extend({
  /** Action exacte (`role.update`) ou préfixe d'une famille (`role.`, `automation`). */
  action: z.string().trim().max(100).optional(),
  actor_id: z.uuid().optional(),
  target_id: z.string().trim().max(100).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/** Journal d'audit de l'instance (P6.3) : `/{app}/audit-logs`. */
@Controller(':app/audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /**
   * Journal d'audit de l'instance, du plus récent au plus ancien. Filtre `action` : action exacte
   * ou famille (`role`, `auth`…).
   */
  @Get()
  @Can('audit:read')
  list(@Query(new ZodValidationPipe(listSchema)) query: z.infer<typeof listSchema>) {
    return this.audit.list(query);
  }

  /** Actions journalisées (catalogue des valeurs de `action`). */
  @Get('actions')
  @Can('audit:read')
  actions() {
    return { data: AUDIT_ACTIONS };
  }
}
