import { type Field } from '@wasafili/form-schema';
import { describe, expect, it } from 'vitest';
import { displayValue, formatDate, formatDateTime, stateLabel } from './display.js';

const field = (value: Record<string, unknown>) =>
  ({ id: 'f', key: 'f', label: 'F', ...value }) as unknown as Field;
const none = new Map<string, string>();

describe('displayValue', () => {
  it('rend les choix, référentiels, booléens et nombres', () => {
    const select = field({ type: 'select', options: [{ value: 'bon', label: 'Bon état' }] });
    expect(displayValue(select, 'bon', none, 'UTC')).toBe('Bon état');
    const multi = field({
      type: 'multiselect',
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
    });
    expect(displayValue(multi, ['a', 'b', 'c'], none, 'UTC')).toBe('A, B, c');
    expect(displayValue(field({ type: 'list' }), 'i1', new Map([['i1', 'Plateau']]), 'UTC')).toBe(
      'Plateau',
    );
    expect(displayValue(field({ type: 'list' }), 'i2', none, 'UTC')).toBe('…');
    expect(displayValue(field({ type: 'boolean' }), false, none, 'UTC')).toBe('Non');
    expect(displayValue(field({ type: 'number', unit: 'kVA' }), 1250.5, none, 'UTC')).toMatch(
      /^1\s?250,5 kVA$/,
    );
  });

  it('rend dates, fichiers, positions, tableaux, notes et utilisateurs', () => {
    expect(displayValue(field({ type: 'date' }), '2026-10-20', none, 'UTC')).toBe('20/10/2026');
    expect(displayValue(field({ type: 'photo' }), [{ fileId: 'a' }], none, 'UTC')).toBe(
      '1 fichier(s)',
    );
    expect(displayValue(field({ type: 'signature' }), { fileId: 's' }, none, 'UTC')).toBe('Signée');
    expect(
      displayValue(
        field({ type: 'geolocation' }),
        { lat: 5.3, lng: -4.01, source: 'gps' },
        none,
        'UTC',
      ),
    ).toBe('5.30000, -4.01000');
    expect(displayValue(field({ type: 'table' }), [{}, {}], none, 'UTC')).toBe('2 ligne(s)');
    expect(displayValue(field({ type: 'rating' }), 3, none, 'UTC')).toBe('★★★');
    const users = new Map([['u1', 'Awa Koné']]);
    expect(displayValue(field({ type: 'user' }), ['u1', 'u2'], none, 'UTC', users)).toBe(
      'Awa Koné, Utilisateur',
    );
    expect(
      displayValue(field({ type: 'calculated', resultType: 'boolean' }), true, none, 'UTC'),
    ).toBe('Oui');
  });

  it('valeur vide ou champ inconnu', () => {
    expect(displayValue(field({ type: 'text' }), '', none, 'UTC')).toBe('—');
    expect(displayValue(undefined, { a: 1 }, none, 'UTC')).toBe('{"a":1}');
    expect(displayValue(field({ type: 'text' }), 'libre', none, 'UTC')).toBe('libre');
  });
});

describe('dates et états', () => {
  it('affiche dans le fuseau demandé, sans décaler une date calendaire', () => {
    expect(formatDateTime('2026-10-20T23:30:00Z', 'Africa/Abidjan')).toBe('20/10/2026 23:30');
    expect(formatDate('2026-10-20T23:30:00Z', 'Asia/Tokyo')).toBe('21/10/2026');
  });

  it('libellé d’état, clé brute à défaut', () => {
    const workflow = { states: [{ key: 'soumis', label: 'Soumis' }] } as never;
    expect(stateLabel(workflow, 'soumis')).toBe('Soumis');
    expect(stateLabel(workflow, 'inconnu')).toBe('inconnu');
    expect(stateLabel(undefined, null)).toBe('—');
  });
});
