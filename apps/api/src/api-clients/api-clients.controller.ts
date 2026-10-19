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
} from '@nestjs/common';
import { z } from 'zod';
import { Audit } from '../audit/audit.interceptor';
import { type Actor, Can, CurrentActor, CurrentInstance } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { type Instance } from '../generated/prisma/client';
import { OpenApi } from '../openapi/openapi.decorator';
import * as resources from '../openapi/resources';
import { PERMISSIONS } from '../tenancy/permissions';
import { ApiClientsService } from './api-clients.service';

const name = z.string().trim().min(1).max(200);
const scopes = z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length);
const createSchema = z.object({ name, scopes });
const updateSchema = z
  .object({ name: name.optional(), scopes: scopes.optional() })
  .refine((body) => body.name !== undefined || body.scopes !== undefined, 'Aucune modification');

/**
 * Clés API : identifiants `client_credentials` des intégrations (n8n, ERP…). Les permissions
 * d'une clé deviennent les scopes de ses jetons.
 */
@Controller(':app/api-clients')
@Can('apikey:manage')
export class ApiClientsController {
  constructor(private readonly clients: ApiClientsService) {}

  /** Clés API de l'instance, actives puis révoquées. */
  @Get()
  @OpenApi({ list: resources.apiClient })
  list() {
    return this.clients.list();
  }

  /**
   * Crée une clé API. Le secret (`clientSecret`) n'est renvoyé qu'ici : seul son empreinte est
   * conservée. Les permissions accordées doivent être détenues par l'appelant.
   */
  @Post()
  @Audit('apikey.create')
  @OpenApi({ response: resources.apiClientWithSecret })
  create(
    @CurrentInstance() instance: Instance,
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>,
  ) {
    return this.clients.create(instance.id, actor, body);
  }

  /** Détail d'une clé API (sans son secret). */
  @Get(':id')
  @OpenApi({ response: resources.apiClient })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.clients.get(id);
  }

  /** Renomme une clé ou change ses permissions, effectives dès la requête suivante. */
  @Patch(':id')
  @Audit('apikey.update')
  @OpenApi({ response: resources.apiClient })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(updateSchema)) body: z.infer<typeof updateSchema>,
  ) {
    return this.clients.update(id, actor, body);
  }

  /** Remplace le secret ; le nouveau n'est renvoyé qu'ici, l'ancien cesse de fonctionner. */
  @Post(':id/secret')
  @HttpCode(200)
  @Audit('apikey.secret')
  @OpenApi({ response: resources.apiClientWithSecret })
  rotate(@Param('id', ParseUUIDPipe) id: string) {
    return this.clients.rotateSecret(id);
  }

  /** Révoque une clé : ses jetons sont refusés dès la requête suivante. */
  @Delete(':id')
  @HttpCode(204)
  @Audit('apikey.revoke')
  revoke(@Param('id', ParseUUIDPipe) id: string) {
    return this.clients.revoke(id);
  }
}
