import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type TeamPosition } from '@wasafili/sdk';
import { lazy, Suspense, useMemo, useState } from 'react';
import { EmptyState, ErrorMessage, Loading, PageHeader } from '@/components/ui/display';
import { useApp } from '@/lib/use-app';
import { cn, formatDateTime } from '@/lib/utils';

const FeatureMap = lazy(() =>
  import('@/components/feature-map').then((m) => ({ default: m.FeatureMap })),
);

const HOUR = 3_600_000;
/** Fraîcheur d'une position : la couleur et le libellé disent si elle est encore fiable. */
const RECENCY = [
  { max: HOUR, color: '#2e8b57', label: 'moins d’une heure' },
  { max: 24 * HOUR, color: '#d98a1b', label: 'aujourd’hui' },
  { max: Infinity, color: '#5b6470', label: 'plus ancienne' },
] as const;
const recency = (at: string) => RECENCY.find((r) => Date.now() - Date.parse(at) < r.max)!;

const fullName = (p: TeamPosition) =>
  `${p.user.firstName} ${p.user.lastName}`.trim() || p.user.email;

/**
 * Suivi des équipes terrain (P6.1.2) : dernière position connue de chaque membre, issue de
 * ses fiches (position de l'appareil) ou des tâches qu'il a terminées.
 */
export function TeamPage() {
  const { api, short, timeZone } = useApp();
  const [selected, setSelected] = useState<string | null>(null);
  const positions = useQuery({
    queryKey: [short, 'team', 'positions'],
    queryFn: () => api.team.positions(),
    refetchInterval: 60_000,
  });
  const data = positions.data?.data ?? [];
  const features = useMemo(
    () =>
      data.map((p) => ({
        type: 'Feature' as const,
        id: p.user.id,
        geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] as [number, number] },
        properties: { id: p.user.id, color: recency(p.at).color },
      })),
    [data],
  );

  return (
    <>
      <PageHeader
        title="Équipes terrain"
        description="Dernière position connue de chaque membre, d’après ses fiches et ses tâches terminées."
      />
      {positions.error && <ErrorMessage error={positions.error} />}
      {positions.isPending && <Loading />}
      {positions.data && data.length === 0 && (
        <EmptyState title="Aucune position connue">
          Les positions apparaissent dès qu’un membre saisit une fiche localisée sur le terrain.
        </EmptyState>
      )}
      {data.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <Suspense fallback={<Loading />}>
            <FeatureMap
              features={features}
              fitKey="team"
              selectedId={selected}
              onSelect={setSelected}
              label="Carte des équipes"
            />
          </Suspense>
          <div>
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface shadow-xs">
              {data.map((p) => {
                const fresh = recency(p.at);
                return (
                  <li key={p.user.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(p.user.id)}
                      aria-pressed={selected === p.user.id}
                      className={cn(
                        'flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-subtle/60',
                        selected === p.user.id && 'bg-primary/5',
                      )}
                    >
                      <span
                        className="mt-1.5 size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: fresh.color }}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{fullName(p)}</span>
                        <span className="block text-xs text-muted">
                          {formatDateTime(p.at, timeZone)} · {fresh.label}
                        </span>
                      </span>
                    </button>
                    {selected === p.user.id && p.source === 'submission' && (
                      <Link
                        to="/$app/submissions/$submissionId"
                        params={{ app: short, submissionId: p.sourceId }}
                        className="block px-9 pb-3 text-xs font-medium text-primary hover:underline"
                      >
                        Voir la fiche
                      </Link>
                    )}
                    {selected === p.user.id && p.source === 'task' && (
                      <p className="px-9 pb-3 text-xs text-muted">Lieu d’une tâche terminée</p>
                    )}
                  </li>
                );
              })}
            </ul>
            <ul className="mt-3 space-y-1 text-xs text-muted">
              {RECENCY.map((r) => (
                <li key={r.label} className="flex items-center gap-2">
                  <span
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: r.color }}
                    aria-hidden
                  />
                  Position {r.label}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
