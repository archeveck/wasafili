/** Dates locales d'un fuseau (D14) côté serveur : jour + heure locale → instant UTC. */

function offsetMs(instant: Date, timeZone: string): number {
  const parts = Object.fromEntries(
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
  const local = Date.UTC(
    Number(parts['year']),
    Number(parts['month']) - 1,
    Number(parts['day']),
    Number(parts['hour']),
    Number(parts['minute']),
    Number(parts['second']),
  );
  return local - Math.floor(instant.getTime() / 1000) * 1000;
}

/** `2026-10-20` à `08:00` dans `timeZone` → instant UTC (heure d'été comprise). */
export function zonedTime(day: string, time: string, timeZone: string): Date {
  const naive = new Date(`${day}T${time}:00Z`);
  const first = new Date(naive.getTime() - offsetMs(naive, timeZone));
  return new Date(naive.getTime() - offsetMs(first, timeZone));
}

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
