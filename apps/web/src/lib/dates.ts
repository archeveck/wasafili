/**
 * Dates calendaires dans le fuseau de l'instance (D14). Les instants restent en UTC ; une date
 * `AAAA-MM-JJ` et une heure `HH:MM` sont interprétées dans le fuseau donné.
 */

const pad = (n: number) => String(n).padStart(2, '0');

function parts(instant: Date, timeZone: string) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  return {
    year: Number(values['year']),
    month: Number(values['month']),
    day: Number(values['day']),
    hour: Number(values['hour']),
    minute: Number(values['minute']),
    second: Number(values['second']),
  };
}

/** Date et heure locales d'un instant. */
export function zoned(instant: Date | string, timeZone: string): { date: string; time: string } {
  const p = parts(new Date(instant), timeZone);
  return {
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    time: `${pad(p.hour)}:${pad(p.minute)}`,
  };
}

/** Instant UTC d'une date et d'une heure locales. */
export function fromZoned(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [h, min] = time.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, h, min);
  // Décalage du fuseau à cet instant (deux passes : changement d'heure éventuel).
  const offset = (at: number) => {
    const p = parts(new Date(at), timeZone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - at;
  };
  const first = guess - offset(guess);
  return new Date(guess - offset(first));
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Lundi de la semaine d'une date. */
export function weekStart(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return addDays(date, -weekday);
}

/** Premier jour du mois d'une date. */
export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function formatDay(date: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', ...options }).format(
    new Date(`${date}T00:00:00Z`),
  );
}
