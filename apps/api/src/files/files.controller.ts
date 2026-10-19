import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { z } from 'zod';
import { type Actor, CurrentActor, CurrentInstance } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { type Instance } from '../generated/prisma/client';
import { FilesService } from './files.service';
import { OpenApi } from '../openapi/openapi.decorator';
import * as resources from '../openapi/resources';

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

  /**
   * Demande le dépôt d'un fichier : renvoie une URL signée de dépôt direct. Rejouer avec le même
   * `id` reprend un dépôt interrompu sans doublon.
   */
  @Post('upload')
  @OpenApi({ response: resources.uploadTicket })
  requestUpload(
    @CurrentInstance() instance: Instance,
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(uploadSchema)) body: z.infer<typeof uploadSchema>,
  ) {
    return this.files.requestUpload(instance.id, actor, body);
  }

  /** Confirme le dépôt : l'objet doit exister avec la taille annoncée. */
  @Post(':id/complete')
  @HttpCode(200)
  @OpenApi({ response: resources.file })
  complete(@Param('id', ParseUUIDPipe) id: string) {
    return this.files.complete(id);
  }

  /** Métadonnées d'un fichier et URL signée de lecture (fichier déposé). */
  @Get(':id')
  @OpenApi({ response: resources.file })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.files.get(id);
  }
}
