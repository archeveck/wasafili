import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Can } from '../auth/decorators';
import { paginationSchema } from '../common/pagination';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { EmailsService } from './emails.service';
import { Audit } from '../audit/audit.interceptor';

const listSchema = paginationSchema.extend({
  status: z.enum(['queued', 'sent', 'failed']).optional(),
});

/** Journal d'envoi des e-mails (P5.2). */
@Controller(':app/emails')
export class EmailsController {
  constructor(private readonly emails: EmailsService) {}

  /** E-mails envoyés par les automatisations, avec leur statut. */
  @Get()
  @Can('automation:manage')
  list(@Query(new ZodValidationPipe(listSchema)) query: z.infer<typeof listSchema>) {
    return this.emails.list(query);
  }

  /** Renvoie un e-mail en échec. */
  @Post(':id/retry')
  @Audit('email.retry')
  @Can('automation:manage')
  retry(@Param('id', ParseUUIDPipe) id: string) {
    return this.emails.retry(id);
  }
}
