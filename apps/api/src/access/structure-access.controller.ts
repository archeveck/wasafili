import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { type StructureDefinition } from '@tesserax/form-schema';
import { z } from 'zod';
import { Can, CurrentInstance } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { type Instance } from '../generated/prisma/client';
import { StructuresService } from '../structures/structures.service';
import { FILTER_OPERATORS } from '../submissions/query';
import { STRUCTURE_PERMISSIONS, StructureAccessService } from './structure-access.service';
import { Audit } from '../audit/audit.interceptor';

const ruleSchema = z
  .object({
    roleId: z.uuid().optional(),
    groupId: z.uuid().optional(),
    permissions: z.array(z.enum(STRUCTURE_PERMISSIONS)),
    visibility: z
      .array(
        z.object({
          key: z.string().min(1),
          operator: z.enum(FILTER_OPERATORS).default('eq'),
          value: z.string().min(1).max(200),
        }),
      )
      .max(10)
      .optional(),
  })
  .refine((rule) => Boolean(rule.roleId) !== Boolean(rule.groupId), {
    message: 'Indiquer soit roleId, soit groupId',
  });
const rulesSchema = z.object({ rules: z.array(ruleSchema).max(100) });

/** Droits par structure (P2.6.2) et filtres de visibilité (P2.6.3). */
@Controller(':app/structures/:id/access')
export class StructureAccessController {
  constructor(
    private readonly access: StructureAccessService,
    private readonly structures: StructuresService,
  ) {}

  @Get()
  @Can('role:read')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    await this.structures.get(id);
    return { data: await this.access.rules(id) };
  }

  @Put()
  @Audit('structure.access', { type: 'structure' })
  @Can('role:manage')
  async replace(
    @CurrentInstance() instance: Instance,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(rulesSchema)) body: z.infer<typeof rulesSchema>,
  ) {
    await this.structures.get(id);
    const version = await this.structures.currentVersion(id);
    const rules = await this.access.replaceRules(
      instance.id,
      id,
      version?.definition as StructureDefinition | undefined,
      body.rules,
    );
    return { data: rules };
  }
}
