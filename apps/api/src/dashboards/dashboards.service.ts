import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { type Field, rootValueFields, type StructureDefinition } from '@tesserax/form-schema';
import { type Actor } from '../auth/decorators';
import { type Dashboard, type Instance, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { filterableFields, numericValue } from '../submissions/query';
import { SubmissionsService } from '../submissions/submissions.service';
import { type DashboardInput, type Widget, type WidgetPeriod } from './widgets';

const NOT_FOUND = { error: 'not_found', message: 'Tableau de bord introuvable' };
/** Catégories affichées au plus par un histogramme (les plus grandes valeurs). */
export const MAX_CATEGORIES = 20;
/** Périodes affichées au plus par une courbe. */
export const MAX_BUCKETS = 400;

const PERIOD_DAYS: Record<Exclude<WidgetPeriod, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '12m': 365,
};

const invalid = (message: string) =>
  new UnprocessableEntityException({ error: 'invalid_widget', message });

export interface WidgetPoint {
  key: string | null;
  label: string;
  value: number | null;
}

export type WidgetData =
  | { type: 'kpi'; value: number | null; count: number }
  | { type: 'bar' | 'line'; series: WidgetPoint[]; truncated: boolean };

/**
 * Tableaux de bord (P6.2). Chaque widget est calculé sur la sélection de fiches de
 * `SubmissionsService.query` : droits par structure, visibilité et RLS s'appliquent, si bien
 * qu'un même tableau montre à chacun les chiffres des seules fiches qu'il peut lire.
 */
@Injectable()
export class DashboardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly submissions: SubmissionsService,
  ) {}

  async list() {
    const dashboards = await this.prisma.db.dashboard.findMany({ orderBy: { name: 'asc' } });
    return { data: dashboards.map((d) => this.toDto(d)) };
  }

  async get(id: string) {
    return this.toDto(await this.find(id));
  }

  async create(instanceId: string, actor: Actor, input: DashboardInput) {
    const dashboard = await this.prisma.db.dashboard.create({
      data: {
        instanceId,
        name: input.name,
        description: input.description ?? null,
        widgets: input.widgets as Prisma.InputJsonArray,
        createdById: actor.userId,
      },
    });
    return this.toDto(dashboard);
  }

  async update(id: string, input: DashboardInput) {
    await this.find(id);
    const dashboard = await this.prisma.db.dashboard.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description ?? null,
        widgets: input.widgets as Prisma.InputJsonArray,
      },
    });
    return this.toDto(dashboard);
  }

  async remove(id: string) {
    await this.find(id);
    await this.prisma.db.dashboard.delete({ where: { id } });
  }

  /** Valeurs d'un widget (enregistré ou en cours d'édition) pour l'appelant. */
  async data(instance: Instance, actor: Actor, widget: Widget): Promise<WidgetData> {
    const from = periodStart(widget.period);
    const { where, definition } = await this.submissions.query(widget.structureId, actor, {
      filters: widget.filters,
      ...(widget.state ? { state: widget.state } : {}),
      ...(from ? { created_from: from } : {}),
    });
    const value = this.metricSql(widget, definition);

    if (widget.type === 'kpi') {
      const [row] = await this.prisma.transaction(
        (tx) => tx.$queryRaw<{ value: number | null; count: bigint }[]>`
          SELECT ${value} AS value, count(*) AS count FROM submissions s WHERE ${where}`,
      );
      return { type: 'kpi', value: row?.value ?? null, count: Number(row?.count ?? 0) };
    }
    if (widget.groupBy?.kind === 'period') {
      return {
        type: 'line',
        series: await this.timeSeries(instance, where, value, widget.groupBy.unit, from, {
          zeroWhenEmpty: widget.metric.op === 'count',
        }),
        truncated: false,
      };
    }

    const field = this.groupField(widget, definition);
    const key =
      widget.groupBy?.kind === 'state'
        ? Prisma.sql`s.state`
        : widget.groupBy?.kind === 'author'
          ? Prisma.sql`s.author_id::text`
          : Prisma.sql`(s.data ->> ${field!.key})`;
    const rows = await this.prisma.transaction(
      (tx) => tx.$queryRaw<{ key: string | null; value: number | null }[]>`
        SELECT ${key} AS key, ${value} AS value FROM submissions s WHERE ${where}
        GROUP BY 1 ORDER BY 2 DESC NULLS LAST, 1 LIMIT ${MAX_CATEGORIES + 1}`,
    );
    const shown = rows.slice(0, MAX_CATEGORIES);
    const labels = await this.labels(widget, definition, field, shown);
    return {
      type: 'bar',
      series: shown.map((row) => ({
        key: row.key,
        label: row.key === null ? 'Non renseigné' : (labels.get(row.key) ?? row.key),
        value: row.value,
      })),
      truncated: rows.length > MAX_CATEGORIES,
    };
  }

  private metricSql(widget: Widget, definition: StructureDefinition | undefined): Prisma.Sql {
    const { op, field } = widget.metric;
    if (op === 'count') return Prisma.sql`count(*)::float8`;
    if (filterableFields(definition).get(field!) !== 'number') {
      throw invalid(`Champ numérique filtrable attendu : ${field}`);
    }
    return Prisma.sql`${Prisma.raw(op)}(${numericValue(field!)})::float8`;
  }

  private groupField(widget: Widget, definition: StructureDefinition | undefined) {
    if (widget.groupBy?.kind !== 'field') return undefined;
    const key = widget.groupBy.field;
    if (filterableFields(definition).get(key) !== 'text') {
      throw invalid(`Regroupement impossible sur : ${key} (champ filtrable à valeur unique)`);
    }
    return rootValueFields(definition?.fields ?? []).find((f) => f.key === key)!;
  }

  /** Une valeur par période, périodes vides comprises, dans le fuseau de l'instance. */
  private async timeSeries(
    instance: Instance,
    where: Prisma.Sql,
    value: Prisma.Sql,
    unit: 'day' | 'week' | 'month',
    from: Date | undefined,
    { zeroWhenEmpty }: { zeroWhenEmpty: boolean },
  ): Promise<WidgetPoint[]> {
    const tz = instance.timeZone;
    const bucket = Prisma.sql`date_trunc(${unit}, s.created_at AT TIME ZONE ${tz})`;
    const start = from
      ? Prisma.sql`${from}::timestamptz`
      : Prisma.sql`(SELECT min(s.created_at) FROM submissions s WHERE ${where})`;
    const [{ count } = { count: 0 }] = await this.prisma.transaction(
      (tx) => tx.$queryRaw<{ count: number | null }[]>`
        SELECT count(*)::int AS count FROM generate_series(
          date_trunc(${unit}, ${start} AT TIME ZONE ${tz}),
          date_trunc(${unit}, now() AT TIME ZONE ${tz}),
          ('1 ' || ${unit})::interval)`,
    );
    if ((count ?? 0) > MAX_BUCKETS) {
      throw invalid('Trop de périodes : choisissez une période plus courte ou un pas plus large');
    }
    const rows = await this.prisma.transaction(
      (tx) => tx.$queryRaw<{ key: string; value: number | null }[]>`
        WITH buckets AS (
          SELECT generate_series(
            date_trunc(${unit}, ${start} AT TIME ZONE ${tz}),
            date_trunc(${unit}, now() AT TIME ZONE ${tz}),
            ('1 ' || ${unit})::interval) AS bucket
        ), agg AS (
          SELECT ${bucket} AS bucket, ${value} AS value FROM submissions s WHERE ${where} GROUP BY 1
        )
        SELECT to_char(b.bucket, 'YYYY-MM-DD') AS key, a.value
        FROM buckets b LEFT JOIN agg a ON a.bucket = b.bucket ORDER BY b.bucket`,
    );
    // Sans fiche, un comptage vaut 0 ; une moyenne reste indéfinie.
    return rows.map((row) => ({
      key: row.key,
      label: row.key,
      value: row.value ?? (zeroWhenEmpty ? 0 : null),
    }));
  }

  private async labels(
    widget: Widget,
    definition: StructureDefinition | undefined,
    field: Field | undefined,
    rows: { key: string | null }[],
  ): Promise<Map<string, string>> {
    const keys = rows.flatMap((row) => (row.key === null ? [] : [row.key]));
    const kind = widget.groupBy?.kind;
    if (kind === 'state') {
      return new Map((definition?.workflow?.states ?? []).map((s) => [s.key, s.label]));
    }
    if (kind === 'author' || field?.type === 'user') {
      const users = await this.prisma.db.user.findMany({
        where: { id: { in: keys.filter(isUuid) } },
        select: { id: true, firstName: true, lastName: true, email: true },
      });
      return new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim() || u.email]));
    }
    if (field?.type === 'select') return new Map(field.options.map((o) => [o.value, o.label]));
    if (field?.type === 'list') {
      const items = await this.prisma.db.listItem.findMany({
        where: { id: { in: keys.filter(isUuid) } },
        select: { id: true, label: true },
      });
      return new Map(items.map((item) => [item.id, item.label]));
    }
    return new Map();
  }

  private async find(id: string) {
    const dashboard = await this.prisma.db.dashboard.findUnique({ where: { id } });
    if (!dashboard) throw new NotFoundException(NOT_FOUND);
    return dashboard;
  }

  private toDto(dashboard: Dashboard) {
    return {
      id: dashboard.id,
      name: dashboard.name,
      description: dashboard.description,
      widgets: dashboard.widgets as Widget[],
      createdById: dashboard.createdById,
      createdAt: dashboard.createdAt,
      updatedAt: dashboard.updatedAt,
    };
  }
}

function periodStart(period: WidgetPeriod): Date | undefined {
  if (period === 'all') return undefined;
  return new Date(Date.now() - PERIOD_DAYS[period] * 24 * 3600 * 1000);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: string) => UUID.test(value);
