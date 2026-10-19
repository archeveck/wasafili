import { useQuery } from '@tanstack/react-query';
import { type Widget } from '@tesserax/sdk';
import { Table2 } from 'lucide-react';
import { useState } from 'react';
import { ErrorMessage, Spinner } from '@/components/ui/display';
import { useApp } from '@/lib/use-app';
import { BarList, DataTable, KpiTile, LineChart, periodLabel } from './charts';

const PERIODS: Record<Widget['period'], string> = {
  '7d': '7 derniers jours',
  '30d': '30 derniers jours',
  '90d': '90 derniers jours',
  '12m': '12 derniers mois',
  all: 'Depuis le début',
};

/**
 * Contenu d'un widget : valeurs calculées par l'API sur les fiches que l'appelant peut lire
 * (un même tableau de bord montre à chacun ses propres chiffres).
 */
export function WidgetView({ widget, structureName }: { widget: Widget; structureName?: string }) {
  const { api, short } = useApp();
  const [asTable, setAsTable] = useState(false);
  // Clé : les seuls paramètres de calcul (le titre ou la largeur ne changent pas les chiffres).
  const { id: _id, title: _title, width: _width, ...computation } = widget;
  const data = useQuery({
    queryKey: [short, 'widget-data', computation],
    queryFn: () => api.dashboards.widgetData(widget),
    refetchInterval: 5 * 60_000,
  });
  const unit = widget.groupBy?.kind === 'period' ? widget.groupBy.unit : 'day';
  const hasSeries = data.data && data.data.type !== 'kpi';

  return (
    <section className="flex h-full flex-col" aria-label={widget.title}>
      <header className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-medium">{widget.title}</h3>
          <p className="truncate text-xs text-muted">
            {[structureName, PERIODS[widget.period]].filter(Boolean).join(' · ')}
          </p>
        </div>
        {hasSeries && (
          <button
            type="button"
            className="rounded p-1 text-muted hover:bg-subtle"
            aria-pressed={asTable}
            aria-label={asTable ? 'Afficher le graphique' : 'Afficher les données'}
            title={asTable ? 'Afficher le graphique' : 'Afficher les données'}
            onClick={() => setAsTable(!asTable)}
          >
            <Table2 className="size-4" />
          </button>
        )}
      </header>
      <div className="min-h-0 flex-1">
        {data.isPending && <Spinner />}
        {data.error && <ErrorMessage error={data.error} />}
        {data.data?.type === 'kpi' && (
          <KpiTile
            value={data.data.value}
            count={data.data.count}
            isCount={widget.metric.op === 'count'}
          />
        )}
        {data.data && data.data.type !== 'kpi' && data.data.series.length === 0 && (
          <p className="text-sm text-muted">Aucune fiche sur la période.</p>
        )}
        {data.data && data.data.type !== 'kpi' && data.data.series.length > 0 && (
          <>
            {asTable ? (
              <DataTable
                series={data.data.series}
                label={(p) => (data.data.type === 'line' ? periodLabel(p.key, unit) : p.label)}
              />
            ) : data.data.type === 'line' ? (
              <LineChart series={data.data.series} unit={unit} />
            ) : (
              <BarList series={data.data.series} />
            )}
            {data.data.truncated && (
              <p className="mt-2 text-xs text-muted">
                Seules les 20 premières catégories sont affichées.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
