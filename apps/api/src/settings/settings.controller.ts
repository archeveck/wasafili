import { BadRequestException, Body, Controller, Get, Patch } from '@nestjs/common';
import { z } from 'zod';
import { Can, CurrentInstance } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { type Instance, type Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const brandingSchema = z.object({
  logoFileId: z.uuid().nullable().optional(),
  primaryColor: color.optional(),
  accentColor: color.optional(),
});
/** Tuile du menu mobile (P2.7) : une structure à saisir, ou un écran de l'application. */
const tileSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().trim().min(1).max(60),
  icon: z.string().regex(/^[a-z0-9-]{1,40}$/),
  kind: z.enum(['structure', 'tasks', 'submissions', 'scan', 'map']),
  structureId: z.uuid().optional(),
  color: color.optional(),
});
const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    timeZone: z
      .string()
      .refine((zone) => {
        try {
          new Intl.DateTimeFormat('fr', { timeZone: zone });
          return true;
        } catch {
          return false;
        }
      }, 'Fuseau horaire inconnu')
      .optional(),
    locale: z.enum(['fr', 'en']).optional(),
    branding: brandingSchema.optional(),
    mobileMenu: z.array(tileSchema).max(24).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Aucune modification');

function settingsDto(instance: Instance) {
  return {
    id: instance.id,
    short: instance.short,
    name: instance.name,
    timeZone: instance.timeZone,
    locale: instance.locale,
    branding: instance.branding,
    mobileMenu: instance.mobileMenu,
  };
}

/** Personnalisation de l'instance (P2.7) : lisible par tout membre, modifiable par l'admin. */
@Controller(':app/settings')
export class SettingsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  get(@CurrentInstance() instance: Instance) {
    return settingsDto(instance);
  }

  @Patch()
  @Can('instance:manage')
  async update(
    @CurrentInstance() instance: Instance,
    @Body(new ZodValidationPipe(updateSchema)) body: z.infer<typeof updateSchema>,
  ) {
    const structureIds = (body.mobileMenu ?? []).flatMap((tile) =>
      tile.kind === 'structure' ? [tile.structureId] : [],
    );
    if (structureIds.some((id) => !id)) {
      throw new BadRequestException({
        error: 'validation_failed',
        message: 'Une tuile « structure » doit indiquer structureId',
      });
    }
    const found = await this.prisma.db.structure.count({
      where: { id: { in: structureIds as string[] }, archivedAt: null },
    });
    if (found !== new Set(structureIds).size) {
      throw new BadRequestException({
        error: 'validation_failed',
        message: 'Structure inconnue dans le menu',
      });
    }
    if (body.branding?.logoFileId) {
      const logo = await this.prisma.db.file.findUnique({
        where: { id: body.branding.logoFileId },
      });
      if (!logo?.mimeType.startsWith('image/')) {
        throw new BadRequestException({
          error: 'validation_failed',
          message: 'Logo : image attendue',
        });
      }
    }
    const updated = await this.prisma.db.instance.update({
      where: { id: instance.id },
      data: {
        ...(body.name ? { name: body.name } : {}),
        ...(body.timeZone ? { timeZone: body.timeZone } : {}),
        ...(body.locale ? { locale: body.locale } : {}),
        ...(body.branding
          ? {
              branding: {
                ...(instance.branding as Record<string, unknown>),
                ...body.branding,
              } as Prisma.InputJsonValue,
            }
          : {}),
        ...(body.mobileMenu ? { mobileMenu: body.mobileMenu as Prisma.InputJsonValue } : {}),
      },
    });
    return settingsDto(updated);
  }
}
