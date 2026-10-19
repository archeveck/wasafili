import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type Workflow } from '@tesserax/form-schema';
import { type Filter } from '@tesserax/sdk';
import { lazy, Suspense, useMemo, useState } from 'react';
import { Card, ErrorMessage, Loading } from '@/components/ui/display';
import { useApp } from '@/lib/use-app';
import { formatDateTime } from '@/lib/utils';
import { StateBadge } from './workflow';

// MapLibre est lourd : chargé seulement à l'ouverture d'une carte.
const FeatureMap = lazy(() =>
  import('@/components/feature-map').then((m) => ({ default: m.FeatureMap })),
);

/**
 * Carte des fiches (P6.1.1) : les fiches localisées de la sélection du tableau (filtres et
 * état), regroupées à faible zoom, colorées par état de workflow.
 */
export function SubmissionsMap({
  structureId,
  workflow,
  filters,
  state,
}: {
  structureId: string;
  workflow: Workflow | undefined;
  filters: Filter[];
  state: string | undefined;
}) {
  const { api, short, timeZone } = useApp();
  const [selected, setSelected] = useState<string | null>(null);
  const map = useQuery({
    queryKey: [short, 'submissions', structureId, 'map', filters, state],
    queryFn: () => api.submissions.map(structureId, { filters, ...(state ? { state } : {}) }),
    placeholderData: (previous) => previous,
  });
  const colors = useMemo(
    () => new Map((workflow?.states ?? []).map((s) => [s.key, s.color])),
    [workflow],
  );
  const features = useMemo(
    () =>
      (map.data?.features ?? []).map((feature) => ({
        ...feature,
        properties: {
          ...feature.properties,
          ...(feature.properties.state && colors.get(feature.properties.state)
            ? { color: colors.get(feature.properties.state)! }
            : {}),
        },
      })),
    [map.data, colors],
  );
  const current = map.data?.features.find((f) => f.id === selected);

  if (map.error) return <ErrorMessage error={map.error} />;
  if (!map.data) return <Loading />;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted" aria-live="polite">
        {map.data.meta.count} fiche(s) localisée(s)
        {map.data.meta.truncated && ' — affichage limité : affinez les filtres'}
      </p>
      <div className="relative">
        <Suspense fallback={<Loading />}>
          <FeatureMap
            features={features}
            fitKey={JSON.stringify([filters, state])}
            selectedId={selected}
            onSelect={setSelected}
            label="Carte des fiches"
          />
        </Suspense>
        {current && (
          <Card className="absolute left-3 top-3 z-10 w-72 space-y-2 p-4 shadow-lg">
            <p className="font-medium">{current.properties.label || 'Fiche sans titre'}</p>
            <div className="flex items-center gap-2 text-xs text-muted">
              <StateBadge workflow={workflow} state={current.properties.state} />
              {formatDateTime(current.properties.createdAt, timeZone)}
            </div>
            <Link
              to="/$app/submissions/$submissionId"
              params={{ app: short, submissionId: current.id }}
              className="text-sm font-medium text-primary hover:underline"
            >
              Ouvrir la fiche
            </Link>
          </Card>
        )}
      </div>
      {map.data.meta.count === 0 && (
        <p className="text-sm text-muted">
          Aucune fiche localisée : la position vient d’un champ géolocalisation ou de l’appareil au
          moment de la saisie.
        </p>
      )}
    </div>
  );
}
