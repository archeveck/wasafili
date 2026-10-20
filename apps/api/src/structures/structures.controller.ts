import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { structureDefinitionJsonSchema } from '@wasafili/form-schema';
import { z } from 'zod';
import { Can, CurrentInstance } from '../auth/decorators';
import { paginationSchema } from '../common/pagination';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { type Instance } from '../generated/prisma/client';
import { StructuresService, type VersionRef } from './structures.service';
import { Audit } from '../audit/audit.interceptor';
import { OpenApi } from '../openapi/openapi.decorator';
import * as resources from '../openapi/resources';

const listQuery = paginationSchema.extend({
  include_archived: z.enum(['true', 'false']).default('false'),
});
const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
  definition: z.unknown().optional(),
});
const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Aucune modification');
const draftSchema = z.object({ definition: z.unknown() });

function parseVersionRef(raw: string): VersionRef {
  if (raw === 'draft' || raw === 'current') return raw;
  const version = Number(raw);
  if (!Number.isInteger(version) || version < 1) {
    throw new BadRequestException({
      error: 'validation_failed',
      message: 'Version attendue : numéro, « draft » ou « current »',
    });
  }
  return version;
}

@Controller(':app/structures')
export class StructuresController {
  constructor(private readonly structures: StructuresService) {}

  /** Formulaires de l'instance. */
  @Get()
  @Can('structure:read')
  @OpenApi({ page: resources.structure })
  list(@Query(new ZodValidationPipe(listQuery)) query: z.infer<typeof listQuery>) {
    return this.structures.list(query, query.include_archived === 'true');
  }

  /** JSON Schema de la définition (documentation, outils externes). */
  @Get('schema')
  @Can('structure:read')
  schema() {
    return structureDefinitionJsonSchema();
  }

  /** Crée un formulaire et son premier brouillon. */
  @Post()
  @Audit('structure.create')
  @Can('structure:create')
  @OpenApi({ response: resources.structure })
  create(
    @CurrentInstance() instance: Instance,
    @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>,
  ) {
    return this.structures.create(instance.id, body);
  }

  /** Détail d'un formulaire et de ses versions. */
  @Get(':id')
  @Can('structure:read')
  @OpenApi({ response: resources.structure })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.structures.get(id);
  }

  /** Renomme ou décrit un formulaire. */
  @Patch(':id')
  @Audit('structure.update')
  @Can('structure:update')
  @OpenApi({ response: resources.structure })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateSchema)) body: z.infer<typeof updateSchema>,
  ) {
    return this.structures.update(id, body);
  }

  /** Archive un formulaire : plus de nouvelle fiche, les fiches existantes restent. */
  @Delete(':id')
  @Audit('structure.delete')
  @HttpCode(204)
  @Can('structure:delete')
  archive(@Param('id', ParseUUIDPipe) id: string) {
    return this.structures.archive(id);
  }

  /** Une version d'un formulaire, avec sa définition. */
  @Get(':id/versions/:version')
  @Can('structure:read')
  @OpenApi({ response: resources.structureVersion })
  version(@Param('id', ParseUUIDPipe) id: string, @Param('version') version: string) {
    return this.structures.getVersion(id, parseVersionRef(version));
  }

  /** Enregistre le brouillon de la définition (crée le brouillon au besoin). */
  @Put(':id/draft')
  @Can('structure:update')
  @OpenApi({ response: resources.structureVersion })
  saveDraft(
    @CurrentInstance() instance: Instance,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(draftSchema)) body: z.infer<typeof draftSchema>,
  ) {
    return this.structures.saveDraft(instance.id, id, body.definition);
  }

  /** Publie le brouillon : il devient la version courante, immuable. */
  @Post(':id/publish')
  @Audit('structure.publish')
  @HttpCode(200)
  @Can('structure:publish')
  @OpenApi({ response: resources.structureVersion })
  publish(@Param('id', ParseUUIDPipe) id: string) {
    return this.structures.publish(id);
  }
}
