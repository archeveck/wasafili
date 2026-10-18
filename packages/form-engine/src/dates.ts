const DAY_MS = 86_400_000;
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;

function parts(date: Date, timeZone: string, options: Intl.DateTimeFormatOptions) {
  const values: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat('en-US', { timeZone, ...options }).formatToParts(
    date,
  )) {
    values[part.type] = part.value;
  }
  return values;
}

/** Date du jour `AAAA-MM-JJ` dans le fuseau donné. */
export function dayIn(date: Date, timeZone: string): string {
  const { year, month, day } = parts(date, timeZone, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return `${year}-${month}-${day}`;
}

/** Heure `HH:MM` dans le fuseau donné. */
export function timeIn(date: Date, timeZone: string): string {
  const { hour, minute } = parts(date, timeZone, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return `${hour}:${minute}`;
}

/** Numéro de jour (depuis 1970-01-01) d'une date ou d'un instant ISO ; `null` si invalide. */
export function dayNumber(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = DAY_PATTERN.exec(value);
  if (!match) return null;
  const [, year, month, day] = match.map(Number) as [number, number, number, number];
  const time = Date.UTC(year, month - 1, day);
  const check = new Date(time);
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return Math.floor(time / DAY_MS);
}

export function formatDay(dayNumberValue: number): string {
  return new Date(dayNumberValue * DAY_MS).toISOString().slice(0, 10);
}
