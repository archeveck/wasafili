import { type WidgetPoint } from '@wasafili/sdk';
import { useEffect, useRef, useState } from 'react';

/** Une seule série par graphique : la couleur primaire de l'instance (pas de légende). */
const SERIES = 'var(--color-primary)';
const GRID = 'var(--color-border)';

const compact = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });
const precise = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

/** Valeur affichée : compacte à partir de 10 000, sinon exacte (2 décimales au plus). */
export const formatValue = (value: number | null) =>
  value === null ? '—' : Math.abs(value) >= 10_000 ? compact.format(value) : precise.format(value);

/** Graduations « rondes » de 0 au maximum (1, 2 ou 5 × 10^n). */
function ticks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw)!;
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, i) => i * step);
}

/** Indicateur seul (KPI) : libellé porté par le titre du widget, valeur en grand. */
export function KpiTile({
  value,
  count,
  isCount,
}: {
  value: number | null;
  count: number;
  /** La valeur est déjà un nombre de fiches : inutile de le rappeler. */
  isCount: boolean;
}) {
  return (
    <div className="flex h-full flex-col justify-end">
      <p className="text-4xl font-semibold leading-none">{formatValue(value)}</p>
      <p className="mt-2 text-xs text-muted">
        {isCount ? 'fiche(s)' : `sur ${formatValue(count)} fiche(s)`}
      </p>
    </div>
  );
}

/**
 * Histogramme horizontal (catégories) : libellé et valeur au-dessus de chaque barre (lisible
 * même dans un widget étroit), barres depuis une ligne de base commune, bout arrondi.
 */
export function BarList({ series }: { series: WidgetPoint[] }) {
  const max = Math.max(0, ...series.map((p) => p.value ?? 0));
  return (
    <ul className="space-y-2.5">
      {series.map((point) => {
        const ratio = max > 0 && point.value ? Math.max(point.value / max, 0.005) : 0;
        return (
          <li
            key={point.key ?? '∅'}
            className="group text-sm"
            title={`${point.label} : ${formatValue(point.value)}`}
          >
            <span className="flex items-baseline justify-between gap-3">
              <span className="truncate text-muted">{point.label}</span>
              <span className="tabular-nums text-foreground">{formatValue(point.value)}</span>
            </span>
            <span className="mt-1 block h-3">
              <span
                className="block h-full rounded-r-[4px] transition-opacity group-hover:opacity-80"
                style={{ width: `${ratio * 100}%`, backgroundColor: SERIES }}
              />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const dayFormat = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const monthFormat = new Intl.DateTimeFormat('fr-FR', {
  month: 'short',
  year: '2-digit',
  timeZone: 'UTC',
});
/** Clé `AAAA-MM-JJ` d'une période (début de jour, semaine ou mois). */
export const periodLabel = (key: string | null, unit: 'day' | 'week' | 'month') =>
  key === null
    ? '—'
    : (unit === 'month' ? monthFormat : dayFormat).format(new Date(`${key}T00:00:00Z`));

const HEIGHT = 180;
const PAD = { top: 12, right: 16, bottom: 24, left: 40 };

/**
 * Courbe dans le temps : trait de 2 px, aire à 10 %, grille horizontale discrète, réticule
 * et infobulle au survol, valeur et point mis en avant à l'extrémité.
 */
export function LineChart({
  series,
  unit,
}: {
  series: WidgetPoint[];
  unit: 'day' | 'week' | 'month';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const values = series.map((p) => p.value);
  const yTicks = ticks(Math.max(0, ...values.map((v) => v ?? 0)));
  const yMax = yTicks.at(-1) || 1;
  const innerW = Math.max(width - PAD.left - PAD.right, 1);
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i: number) =>
    PAD.left + (series.length > 1 ? (i / (series.length - 1)) * innerW : innerW / 2);
  const y = (v: number) => PAD.top + innerH - (v / yMax) * innerH;
  const defined = series.flatMap((p, i) => (p.value === null ? [] : [{ i, v: p.value }]));
  const path = defined.map(({ i, v }, k) => `${k === 0 ? 'M' : 'L'}${x(i)},${y(v)}`).join('');
  const area =
    defined.length > 1
      ? `${path}L${x(defined.at(-1)!.i)},${y(0)}L${x(defined[0]!.i)},${y(0)}Z`
      : '';
  const last = defined.at(-1);
  const labelEvery = Math.max(1, Math.ceil(series.length / Math.max(2, Math.floor(innerW / 70))));
  const lastIndex = series.length - 1;
  // Graduations régulières, plus la dernière période ; une graduation trop proche d'elle s'efface.
  const showLabel = (i: number) =>
    i === lastIndex ||
    (i % labelEvery === 0 && (lastIndex - i >= labelEvery / 2 || lastIndex - i === 0));

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - box.left - PAD.left) / innerW;
    setHover(Math.min(series.length - 1, Math.max(0, Math.round(ratio * (series.length - 1)))));
  };
  const hovered = hover === null ? undefined : series[hover];

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`Courbe sur ${series.length} périodes, dernière valeur ${formatValue(last?.v ?? null)}`}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {yTicks.map((tick) => (
            <g key={tick}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(tick)}
                y2={y(tick)}
                stroke={GRID}
                strokeWidth={1}
              />
              <text
                x={PAD.left - 6}
                y={y(tick)}
                dy="0.32em"
                textAnchor="end"
                className="fill-muted text-[10px] tabular-nums"
              >
                {formatValue(tick)}
              </text>
            </g>
          ))}
          {series.map((point, i) =>
            showLabel(i) ? (
              <text
                key={point.key ?? i}
                x={x(i)}
                y={HEIGHT - 6}
                textAnchor="middle"
                className="fill-muted text-[10px]"
              >
                {periodLabel(point.key, unit)}
              </text>
            ) : null,
          )}
          {area && <path d={area} fill={SERIES} fillOpacity={0.1} />}
          <path
            d={path}
            fill="none"
            stroke={SERIES}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {hover !== null && (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD.top}
              y2={PAD.top + innerH}
              stroke="var(--color-muted)"
              strokeWidth={1}
            />
          )}
          {hovered?.value != null && (
            <circle
              cx={x(hover!)}
              cy={y(hovered.value)}
              r={4}
              fill={SERIES}
              stroke="var(--color-surface)"
              strokeWidth={2}
            />
          )}
          {last && hover === null && (
            <>
              <circle
                cx={x(last.i)}
                cy={y(last.v)}
                r={4}
                fill={SERIES}
                stroke="var(--color-surface)"
                strokeWidth={2}
              />
              <text
                x={x(last.i) - 8}
                y={y(last.v) - 10}
                textAnchor="end"
                className="fill-foreground text-[11px] font-medium tabular-nums"
              >
                {formatValue(last.v)}
              </text>
            </>
          )}
        </svg>
      )}
      {hovered && (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-md border border-border bg-surface px-2 py-1 text-xs shadow-lg"
          style={{
            left: Math.min(x(hover!) + 8, Math.max(width - 120, 0)),
          }}
        >
          <p className="text-muted">{periodLabel(hovered.key, unit)}</p>
          <p className="font-medium tabular-nums">{formatValue(hovered.value)}</p>
        </div>
      )}
    </div>
  );
}

/** Vue tableau des valeurs d'un graphique (accessibilité, lecture exacte). */
export function DataTable({
  series,
  label,
}: {
  series: WidgetPoint[];
  label: (point: WidgetPoint) => string;
}) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {series.map((point, i) => (
          <tr key={point.key ?? i} className="border-b border-border last:border-0">
            <td className="py-1 text-muted">{label(point)}</td>
            <td className="py-1 text-right tabular-nums">{formatValue(point.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
