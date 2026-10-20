import { useQuery } from '@tanstack/react-query';
import { rootValueFields } from '@wasafili/form-schema';
import { type Widget, type WidgetGroupBy, type WidgetMetric } from '@wasafili/sdk';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/display';
import { FormRow, Input, Select } from '@/components/ui/form-controls';
import { Dialog } from '@/components/ui/overlays';
import { useApp } from '@/lib/use-app';
import { FilterBar } from '../submissions/submissions-page';
import { WidgetView } from './widget-view';

const NUMERIC = new Set(['number', 'rating', 'slider']);
/** Champs à valeur unique, filtrables : regroupement possible. */
const GROUPABLE = new Set(['select', 'list', 'user', 'text', 'barcode']);

export function newWidget(structureId: string): Widget {
  return {
    id: crypto.randomUUID(),
    type: 'kpi',
    title: 'Nombre de fiches',
    structureId,
    width: 1,
    metric: { op: 'count' },
    filters: [],
    period: '30d',
  };
}

/** Configuration d'un widget (P6.2.2), avec aperçu calculé en direct. */
export function WidgetDialog({
  open,
  initial,
  onClose,
  onSave,
}: {
  open: boolean;
  initial: Widget;
  onClose: () => void;
  onSave: (widget: Widget) => void;
}) {
  const { api, short } = useApp();
  const [widget, setWidget] = useState(initial);
  useEffect(() => setWidget(initial), [initial]);
  const set = (patch: Partial<Widget>) => setWidget((current) => ({ ...current, ...patch }));

  const structures = useQuery({
    queryKey: [short, 'structures', 'list'],
    queryFn: () => api.structures.list({ perPage: 100 }),
  });
  const version = useQuery({
    queryKey: [short, 'version', widget.structureId, 'current'],
    queryFn: () => api.structures.version(widget.structureId, 'current'),
    enabled: !!widget.structureId,
  });
  const fields = version.data ? rootValueFields(version.data.definition.fields) : [];
  const numeric = fields.filter((f) => f.filterable && NUMERIC.has(f.type));
  const groupable = fields.filter(
    (f) => f.filterable && GROUPABLE.has(f.type) && !('multiple' in f && f.multiple),
  );
  const workflow = version.data?.definition.workflow;

  const changeType = (type: Widget['type']) => {
    const groupBy: WidgetGroupBy | undefined =
      type === 'kpi'
        ? undefined
        : type === 'line'
          ? { kind: 'period', unit: 'day' }
          : workflow
            ? { kind: 'state' }
            : { kind: 'author' };
    const { groupBy: _previous, ...rest } = widget;
    setWidget({ ...rest, type, ...(groupBy ? { groupBy } : {}) });
  };
  const metricValue =
    widget.metric.op === 'count' ? 'count' : `${widget.metric.op}:${widget.metric.field}`;
  const groupValue =
    widget.groupBy?.kind === 'field'
      ? `field:${widget.groupBy.field}`
      : widget.groupBy?.kind === 'period'
        ? `period:${widget.groupBy.unit}`
        : (widget.groupBy?.kind ?? '');

  const valid = !!widget.title.trim() && !!widget.structureId && !!version.data;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Widget"
      wide
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button disabled={!valid} onClick={() => onSave(widget)}>
            Valider
          </Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <FormRow label="Titre" htmlFor="widget-title" required>
            <Input
              id="widget-title"
              value={widget.title}
              onChange={(e) => set({ title: e.target.value })}
            />
          </FormRow>
          <FormRow label="Formulaire" htmlFor="widget-structure">
            <Select
              id="widget-structure"
              value={widget.structureId}
              onChange={(e) =>
                set({ structureId: e.target.value, filters: [], metric: { op: 'count' } })
              }
            >
              {(structures.data?.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </FormRow>
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="Affichage" htmlFor="widget-type">
              <Select
                id="widget-type"
                value={widget.type}
                onChange={(e) => changeType(e.target.value as Widget['type'])}
              >
                <option value="kpi">Indicateur</option>
                <option value="bar">Histogramme</option>
                <option value="line">Courbe</option>
              </Select>
            </FormRow>
            <FormRow label="Largeur" htmlFor="widget-width">
              <Select
                id="widget-width"
                value={widget.width}
                onChange={(e) => set({ width: Number(e.target.value) })}
              >
                {[1, 2, 3, 4].map((w) => (
                  <option key={w} value={w}>
                    {w} colonne{w > 1 ? 's' : ''}
                  </option>
                ))}
              </Select>
            </FormRow>
          </div>
          <FormRow label="Valeur" htmlFor="widget-metric">
            <Select
              id="widget-metric"
              value={metricValue}
              onChange={(e) => {
                const [op, field] = e.target.value.split(':');
                set({
                  metric: (op === 'count' ? { op } : { op, field }) as WidgetMetric,
                });
              }}
            >
              <option value="count">Nombre de fiches</option>
              {numeric.flatMap((f) =>
                (
                  [
                    ['sum', 'Somme'],
                    ['avg', 'Moyenne'],
                    ['min', 'Minimum'],
                    ['max', 'Maximum'],
                  ] as const
                ).map(([op, label]) => (
                  <option key={`${op}:${f.key}`} value={`${op}:${f.key}`}>
                    {label} — {f.label}
                  </option>
                )),
              )}
            </Select>
          </FormRow>
          {widget.type !== 'kpi' && (
            <FormRow
              label={widget.type === 'line' ? 'Pas de temps' : 'Regrouper par'}
              htmlFor="widget-group"
            >
              <Select
                id="widget-group"
                value={groupValue}
                onChange={(e) => {
                  const [kind, arg] = e.target.value.split(':');
                  set({
                    groupBy: (kind === 'field'
                      ? { kind, field: arg }
                      : kind === 'period'
                        ? { kind, unit: arg }
                        : { kind }) as WidgetGroupBy,
                  });
                }}
              >
                {widget.type === 'line' ? (
                  <>
                    <option value="period:day">Jour</option>
                    <option value="period:week">Semaine</option>
                    <option value="period:month">Mois</option>
                  </>
                ) : (
                  <>
                    {workflow && <option value="state">État</option>}
                    <option value="author">Auteur</option>
                    {groupable.map((f) => (
                      <option key={f.key} value={`field:${f.key}`}>
                        {f.label}
                      </option>
                    ))}
                  </>
                )}
              </Select>
            </FormRow>
          )}
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="Période" htmlFor="widget-period">
              <Select
                id="widget-period"
                value={widget.period}
                onChange={(e) => set({ period: e.target.value as Widget['period'] })}
              >
                <option value="7d">7 derniers jours</option>
                <option value="30d">30 derniers jours</option>
                <option value="90d">90 derniers jours</option>
                <option value="12m">12 derniers mois</option>
                <option value="all">Depuis le début</option>
              </Select>
            </FormRow>
            {workflow && (
              <FormRow label="État" htmlFor="widget-state">
                <Select
                  id="widget-state"
                  value={widget.state ?? ''}
                  onChange={(e) => {
                    const { state: _previous, ...rest } = widget;
                    setWidget(e.target.value ? { ...rest, state: e.target.value } : rest);
                  }}
                >
                  <option value="">Tous</option>
                  {workflow.states.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </FormRow>
            )}
          </div>
          <div>
            <p className="mb-1 text-sm font-medium">Filtres</p>
            <FilterBar
              fields={fields}
              filters={widget.filters}
              onChange={(filters) => set({ filters })}
            />
          </div>
        </div>
        <Card className="min-h-48 p-4">
          <p className="mb-2 text-xs uppercase tracking-wide text-muted">Aperçu</p>
          {valid && <WidgetView widget={widget} />}
        </Card>
      </div>
    </Dialog>
  );
}
