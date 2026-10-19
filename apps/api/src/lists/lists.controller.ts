/// <reference types="multer" />
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
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { type Response } from 'express';
import { z } from 'zod';
import { Can, CurrentInstance } from '../auth/decorators';
import { paginationSchema } from '../common/pagination';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { type Instance } from '../generated/prisma/client';
import { ListsService } from './lists.service';
import { Audit } from '../audit/audit.interceptor';

const levels = z.array(z.string().trim().min(1).max(100)).min(1).max(10);
const createListSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
  levels,
});
const updateListSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  levels: levels.optional(),
});
const code = z.string().trim().min(1).max(100);
const attributes = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));
const createItemSchema = z.object({
  label: z.string().trim().min(1).max(300),
  code: code.optional(),
  parentId: z.uuid().optional(),
  attributes: attributes.optional(),
  position: z.number().int().min(0).optional(),
});
const updateItemSchema = z
  .object({
    label: z.string().trim().min(1).max(300).optional(),
    code: code.nullable().optional(),
    attributes: attributes.optional(),
    position: z.number().int().min(0).optional(),
    /** `false` : restaure un élément archivé. */
    archived: z.literal(false).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Aucune modification');
const itemQuerySchema = paginationSchema.extend({
  parent_id: z.union([z.literal('root'), z.uuid()]).optional(),
  level: z.coerce.number().int().min(0).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  code: code.optional(),
  include_archived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});
const mappingSchema = z.array(
  z.object({
    label: z.string().min(1),
    code: z.string().min(1).optional(),
    attributes: z.record(z.string(), z.string().min(1)).optional(),
  }),
);
const importSchema = z.object({
  mode: z.enum(['merge', 'replace']).default('merge'),
  dry_run: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  mapping: z
    .string()
    .optional()
    .transform((raw, ctx) => {
      if (raw === undefined) return undefined;
      try {
        return mappingSchema.parse(JSON.parse(raw));
      } catch {
        ctx.addIssue({ code: 'custom', message: 'mapping : JSON invalide' });
        return z.NEVER;
      }
    }),
});
const exportSchema = z.object({ format: z.enum(['csv', 'xlsx']).default('xlsx') });
const lookupSchema = z
  .object({
    code: code.optional(),
    ids: z
      .string()
      .transform((raw) => raw.split(',').filter(Boolean))
      .pipe(z.array(z.uuid()).max(200))
      .optional(),
  })
  .refine((query) => Boolean(query.code) !== Boolean(query.ids), 'Indiquer code ou ids');

const MIME = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;

@Controller(':app')
export class ListsController {
  constructor(private readonly lists: ListsService) {}

  @Get('lists')
  @Can('list:read')
  list(
    @Query(new ZodValidationPipe(paginationSchema)) pagination: z.infer<typeof paginationSchema>,
  ) {
    return this.lists.list(pagination);
  }

  @Post('lists')
  @Audit('list.create')
  @Can('list:manage')
  create(
    @CurrentInstance() instance: Instance,
    @Body(new ZodValidationPipe(createListSchema)) body: z.infer<typeof createListSchema>,
  ) {
    return this.lists.create(instance.id, body);
  }

  /**
   * Éléments de tous les référentiels, par code (scan QR) ou par identifiants (libellés des
   * valeurs affichées dans les listes de fiches).
   */
  @Get('list-items')
  @Can('list:read')
  lookup(@Query(new ZodValidationPipe(lookupSchema)) query: z.infer<typeof lookupSchema>) {
    return this.lists.lookup(query).then((data) => ({ data }));
  }

  @Get('lists/:id')
  @Can('list:read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.lists.get(id);
  }

  @Patch('lists/:id')
  @Audit('list.update')
  @Can('list:manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateListSchema)) body: z.infer<typeof updateListSchema>,
  ) {
    return this.lists.update(id, body);
  }

  @Delete('lists/:id')
  @Audit('list.delete')
  @HttpCode(204)
  @Can('list:manage')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.lists.remove(id);
  }

  @Get('lists/:id/items')
  @Can('list:read')
  items(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(itemQuerySchema)) query: z.infer<typeof itemQuerySchema>,
  ) {
    return this.lists.items(id, query);
  }

  @Post('lists/:id/items')
  @Can('list:manage')
  createItem(
    @CurrentInstance() instance: Instance,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(createItemSchema)) body: z.infer<typeof createItemSchema>,
  ) {
    return this.lists.createItem(instance.id, id, body);
  }

  @Patch('lists/:id/items/:itemId')
  @Can('list:manage')
  updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body(new ZodValidationPipe(updateItemSchema)) body: z.infer<typeof updateItemSchema>,
  ) {
    return this.lists.updateItem(id, itemId, body);
  }

  @Delete('lists/:id/items/:itemId')
  @HttpCode(204)
  @Can('list:manage')
  archiveItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return this.lists.archiveItem(id, itemId);
  }

  /** Import CSV/XLSX (multipart : `file`, `mode`, `dry_run`, `mapping` JSON). */
  @Post('lists/:id/import')
  @Audit('list.import')
  @HttpCode(200)
  @Can('list:manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  import(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(importSchema)) body: z.infer<typeof importSchema>,
  ) {
    if (!file) {
      throw new BadRequestException({
        error: 'validation_failed',
        message: 'Fichier « file » requis',
      });
    }
    return this.lists.import(id, file.buffer, {
      mode: body.mode,
      dryRun: body.dry_run,
      ...(body.mapping ? { mapping: body.mapping } : {}),
    });
  }

  @Get('lists/:id/export')
  @Can('list:read')
  async export(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(exportSchema)) query: z.infer<typeof exportSchema>,
    @Res() res: Response,
  ) {
    const { name, content } = await this.lists.export(id, query.format);
    const filename = `${name.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'referentiel'}.${query.format}`;
    res.status(200).type(MIME[query.format]).attachment(filename).send(content);
  }
}
