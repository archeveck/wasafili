import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { dayIn } from '@tesserax/form-engine';
import { type Field, type Workflow } from '@tesserax/form-schema';
import { type Filter, type Submission } from '@tesserax/sdk';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ErrorMessage, Loading } from '@/components/ui/display';
import { Select } from '@/components/ui/form-controls';
import { addDays, formatDay, fromZoned, monthStart, weekStart, zoned } from '@/lib/dates';
import { useApp } from '@/lib/use-app';
import { cn } from '@/lib/utils';

/** Au-delà, le calendrier invite à filtrer (pages de 100 fiches chargées une à une). */
const MAX_FICHES = 1000;
const PER_DAY = 4;

/**
 * Calendrier des fiches (P4.4.4) : un mois, par date de création ou par un champ date
 * filtrable. Les filtres et l'état choisis dans le tableau s'appliquent aussi.
 */
export function SubmissionsCalendar({
  structureId,
  fields,
  workflow,
  filters,
  state,
}: {
  structureId: string;
  fields: Field[];
  workflow: Workflow | undefined;
  filters: Filter[];
  state: string | undefined;
}) {
  const { api, short, timeZone } = useApp();
  const today = dayIn(new Date(), timeZone);
  const [month, setMonth] = useState(() => monthStart(today));
  const dateFields = fields.filter((f) => f.type === 'date' && f.filterable);
  const [source, setSource] = useState<string>('createdAt');
  const next = monthStart(addDays(month, 31));

  const fiches = useQuery({
    queryKey: [short, 'submissions', structureId, 'calendar', month, source, filters, state],
    queryFn: async () => {
      const range =
        source === 'createdAt'
          ? {
              createdFrom: fromZoned(month, '00:00', timeZone).toISOString(),
              createdTo: fromZoned(next, '00:00', timeZone).toISOString(),
            }
          : {};
      const period: Filter[] =
        source === 'createdAt'
          ? []
          : [
              { key: source, operator: 'gte', value: month },
              { key: source, operator: 'lt', value: next },
            ];
      const all: Submission[] = [];
      for (let page = 1; all.length < MAX_FICHES; page++) {
        const result = await api.submissions.list(structureId, {
          ...range,
          ...(state ? { state } : {}),
          filters: [...filters, ...period],
          page,
          perPage: 100,
        });
        all.push(...result.data);
        if (page >= result.meta.totalPages) return { data: all, total: result.meta.total };
      }
      return { data: all, total: all.length };
    },
    placeholderData: (previous) => previous,
  });

  const byDay = useMemo(() => {
    const map = new Map<string, Submission[]>();
    for (const fiche of fiches.data?.data ?? []) {
      const day =
        source === 'createdAt'
          ? zoned(fiche.createdAt, timeZone).date
          : String(fiche.data[source] ?? '');
      map.set(day, [...(map.get(day) ?? []), fiche]);
    }
    return map;
  }, [fiches.data, source, timeZone]);

  const first = weekStart(month);
  const weeks = Array.from({ length: 6 }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => addDays(first, w * 7 + d)),
  ).filter((days) => days[0]! < next);
  const color = (fiche: Submission) => workflow?.states.find((s) => s.key === fiche.state)?.color;
  const label = (fiche: Submission) =>
    workflow?.states.find((s) => s.key === fiche.state)?.label ??
    `Fiche ${zoned(fiche.createdAt, timeZone).time}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label="Mois précédent"
          onClick={() => setMonth(monthStart(addDays(month, -1)))}
        >
          <ChevronLeft />
        </Button>
        <p className="min-w-40 text-center font-medium capitalize">
          {formatDay(month, { month: 'long', year: 'numeric' })}
        </p>
        <Button
          variant="outline"
          size="icon"
          aria-label="Mois suivant"
          onClick={() => setMonth(next)}
        >
          <ChevronRight />
        </Button>
        <Button variant="outline" onClick={() => setMonth(monthStart(today))}>
          Ce mois-ci
        </Button>
        <Select
          aria-label="Date utilisée"
          className="ml-auto w-auto"
          value={source}
          onChange={(e) => setSource(e.target.value)}
        >
          <option value="createdAt">Date de création</option>
          {dateFields.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </Select>
      </div>
      {fiches.error && <ErrorMessage error={fiches.error} />}
      {fiches.isPending && <Loading />}
      {fiches.data && fiches.data.total > fiches.data.data.length && (
        <p className="text-xs text-warning">
          {fiches.data.total} fiches ce mois-ci : seules les {fiches.data.data.length} premières
          sont affichées, affinez les filtres.
        </p>
      )}
      <table
        className="w-full table-fixed border-collapse text-xs"
        aria-label="Calendrier des fiches"
      >
        <thead>
          <tr>
            {weeks[0]!.map((day) => (
              <th key={day} className="p-1 text-left font-medium text-muted">
                {formatDay(day, { weekday: 'short' })}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((days) => (
            <tr key={days[0]}>
              {days.map((day) => {
                const items = byDay.get(day) ?? [];
                return (
                  <td
                    key={day}
                    className={cn(
                      'h-24 border border-border p-1 align-top',
                      !day.startsWith(month.slice(0, 7)) && 'bg-subtle/50 text-muted',
                    )}
                  >
                    <p className={cn('mb-1 font-medium', day === today && 'text-primary')}>
                      {Number(day.slice(8))}
                    </p>
                    {items.slice(0, PER_DAY).map((fiche) => (
                      <Link
                        key={fiche.id}
                        to="/$app/submissions/$submissionId"
                        params={{ app: short, submissionId: fiche.id }}
                        className="mb-0.5 flex items-center gap-1 truncate rounded px-1 hover:bg-subtle"
                      >
                        <span
                          className="size-2 shrink-0 rounded-full bg-primary"
                          style={color(fiche) ? { backgroundColor: color(fiche) } : undefined}
                        />
                        {label(fiche)}
                      </Link>
                    ))}
                    {items.length > PER_DAY && (
                      <p className="px-1 text-muted">+{items.length - PER_DAY} autre(s)</p>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
