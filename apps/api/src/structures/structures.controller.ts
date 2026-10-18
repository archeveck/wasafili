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
import { structureDefinitionJsonSchema } from '@tesserax/form-schema';
import { z } from 'zod';
import { Can, CurrentInstance } from '../auth/decorators';
import { paginationSchema } from '../common/pagination';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { type Instance } from '../generated/prisma/client';
import { StructuresService, type VersionRef } from './structures.service';

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

  @Get()
  @Can('structure:read')
  list(@Query(new ZodValidationPipe(listQuery)) query: z.infer<typeof listQuery>) {
    return this.structures.list(query, query.include_archived === 'true');
  }

  /** JSON Schema de la définition (documentation, outils externes). */
  @Get('schema')
  @Can('structure:read')
  schema() {
    return structureDefinitionJsonSchema();
  }

  @Post()
  @Can('structure:create')
  create(
    @CurrentInstance() instance: Instance,
    @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>,
  ) {
    return this.structures.create(instance.id, body);
  }

  @Get(':id')
  @Can('structure:read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.structures.get(id);
  }

  @Patch(':id')
  @Can('structure:update')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateSchema)) body: z.infer<typeof updateSchema>,
  ) {
    return this.structures.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @Can('structure:delete')
  archive(@Param('id', ParseUUIDPipe) id: string) {
    return this.structures.archive(id);
  }

  @Get(':id/versions/:version')
  @Can('structure:read')
  version(@Param('id', ParseUUIDPipe) id: string, @Param('version') version: string) {
    return this.structures.getVersion(id, parseVersionRef(version));
  }

  @Put(':id/draft')
  @Can('structure:update')
  saveDraft(
    @CurrentInstance() instance: Instance,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(draftSchema)) body: z.infer<typeof draftSchema>,
  ) {
    return this.structures.saveDraft(instance.id, id, body.definition);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @Can('structure:publish')
  publish(@Param('id', ParseUUIDPipe) id: string) {
    return this.structures.publish(id);
  }
}
