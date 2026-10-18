import { describe, expect, it } from 'vitest';
import { addDays, fromZoned, monthStart, weekStart, zoned } from './dates';

describe('dates par fuseau', () => {
  it('lit la date et l’heure locales d’un instant', () => {
    expect(zoned('2026-11-02T23:30:00Z', 'Africa/Abidjan')).toEqual({
      date: '2026-11-02',
      time: '23:30',
    });
    expect(zoned('2026-11-02T23:30:00Z', 'Europe/Paris')).toEqual({
      date: '2026-11-03',
      time: '00:30',
    });
  });

  it('convertit une heure locale en instant UTC, changements d’heure compris', () => {
    expect(fromZoned('2026-11-02', '08:00', 'Africa/Abidjan').toISOString()).toBe(
      '2026-11-02T08:00:00.000Z',
    );
    expect(fromZoned('2026-07-01', '08:00', 'Europe/Paris').toISOString()).toBe(
      '2026-07-01T06:00:00.000Z',
    );
    expect(fromZoned('2026-12-01', '08:00', 'Europe/Paris').toISOString()).toBe(
      '2026-12-01T07:00:00.000Z',
    );
  });

  it('calcule jours, semaines et mois', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(weekStart('2026-11-08')).toBe('2026-11-02'); // dimanche → lundi précédent
    expect(weekStart('2026-11-02')).toBe('2026-11-02');
    expect(monthStart('2026-11-18')).toBe('2026-11-01');
  });
});
