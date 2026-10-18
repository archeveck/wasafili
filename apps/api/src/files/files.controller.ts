import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { type Actor, CurrentActor, CurrentInstance } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { type Instance } from '../generated/prisma/client';
import { FilesService } from './files.service';

const uploadSchema = z.object({
  /** UUID généré par le client : la fiche peut le référencer avant la fin du dépôt. */
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(255),
  mimeType: z.string().regex(/^[\w.+-]+\/[\w.+-]+$/, 'Type MIME invalide'),
  size: z.number().int().min(1),
});

/** Tout membre de l'instance peut déposer des fichiers (photos, signatures, pièces jointes). */
@Controller(':app/files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post('upload')
  requestUpload(
    @CurrentInstance() instance: Instance,
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(uploadSchema)) body: z.infer<typeof uploadSchema>,
  ) {
    return this.files.requestUpload(instance.id, actor, body);
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(@Param('id', ParseUUIDPipe) id: string) {
    return this.files.complete(id);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.files.get(id);
  }
}
