import { z } from 'zod';
import { FILTER_OPERATORS } from '../submissions/query';

/** Périodes glissantes d'un widget, sur la date de création des fiches. */
export const WIDGET_PERIODS = ['7d', '30d', '90d', '12m', 'all'] as const;
export type WidgetPeriod = (typeof WIDGET_PERIODS)[number];

const filter = z.object({
  key: z.string().trim().min(1).max(100),
  operator: z.enum(FILTER_OPERATORS),
  value: z.string().max(500),
});

const groupBy = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('state') }),
  z.object({ kind: z.literal('author') }),
  z.object({ kind: z.literal('field'), field: z.string().trim().min(1).max(100) }),
  z.object({ kind: z.literal('period'), unit: z.enum(['day', 'week', 'month']) }),
]);

/**
 * Widget de tableau de bord (P6.2.1) : un indicateur (`kpi`) ou un graphique (`bar` par
 * catégorie, `line` dans le temps) calculé sur les fiches d'une structure.
 */
export const widgetSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    type: z.enum(['kpi', 'bar', 'line']),
    title: z.string().trim().min(1).max(200),
    structureId: z.uuid(),
    /** Colonnes occupées sur une grille de 4. */
    width: z.number().int().min(1).max(4).default(1),
    metric: z.object({
      op: z.enum(['count', 'sum', 'avg', 'min', 'max']),
      /** Champ numérique filtrable (toutes les opérations sauf `count`). */
      field: z.string().trim().min(1).max(100).optional(),
    }),
    groupBy: groupBy.optional(),
    filters: z.array(filter).max(20).default([]),
    state: z.string().trim().max(100).optional(),
    period: z.enum(WIDGET_PERIODS).default('30d'),
  })
  .superRefine((widget, ctx) => {
    const issue = (path: string[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    if (widget.metric.op !== 'count' && !widget.metric.field) {
      issue(['metric', 'field'], 'Choisissez le champ numérique à agréger');
    }
    if (widget.type === 'kpi' && widget.groupBy) {
      issue(['groupBy'], 'Un indicateur ne se regroupe pas');
    }
    if (widget.type === 'bar' && (!widget.groupBy || widget.groupBy.kind === 'period')) {
      issue(['groupBy'], 'Un histogramme se regroupe par état, auteur ou champ');
    }
    if (widget.type === 'line' && widget.groupBy?.kind !== 'period') {
      issue(['groupBy'], 'Une courbe se regroupe par période');
    }
  });

export type Widget = z.infer<typeof widgetSchema>;

export const dashboardSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).nullable().optional(),
  widgets: z
    .array(widgetSchema)
    .max(40)
    .refine((widgets) => new Set(widgets.map((w) => w.id)).size === widgets.length, {
      message: 'Identifiants de widgets en double',
    })
    .default([]),
});
export type DashboardInput = z.infer<typeof dashboardSchema>;
