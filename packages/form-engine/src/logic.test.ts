import { describe, expect, it } from 'vitest';
import { dayIn, dayNumber, formatDay, timeIn } from './dates.js';
import { evaluate, inspectLogic, isEmpty, roundTo, toNumber, truthy } from './logic.js';

describe('opérations personnalisées', () => {
  it.each([
    [{ empty: [{ var: 'x' }] }, {}, true],
    [{ empty: [[]] }, {}, true],
    [{ empty: [0] }, {}, false],
    [{ in_list: [{ var: 'm' }, ['b', 'z']] }, { m: ['a', 'b'] }, true],
    [{ in_list: [{ var: 'v' }, 'a'] }, { v: 'a' }, true],
    [{ pluck: [{ var: 'rows' }, 'x'] }, { rows: [{ x: 1 }, null, 'y'] }, [1, undefined, undefined]],
    [{ pluck: [{ var: 'absent' }, 'x'] }, {}, []],
    [{ sum: [[1, 'a', '2'], 3] }, {}, 6],
    [{ avg: [[]] }, {}, null],
    [{ min_of: [[]] }, {}, null],
    [{ max_of: [[5, 7]] }, {}, 7],
    [{ max_of: [[]] }, {}, null],
    [{ count: [['a', '', null, []]] }, {}, 1],
    [{ round: ['1.005', 2] }, {}, 1.01],
    [{ round: [-2.5] }, {}, -3],
    [{ round: ['x', 2] }, {}, null],
    [{ abs: ['x'] }, {}, null],
    [{ concat: [['a', 1], null] }, {}, 'a1'],
    [{ days_between: ['x', '2026-01-01'] }, {}, null],
    [{ add_days: ['2026-01-01', 'x'] }, {}, null],
    [{ add_days: ['2026-01-01', 1.9] }, {}, '2026-01-02'],
  ])('%j', (logic, data, expected) => {
    expect(evaluate(logic, data)).toEqual(expected);
  });

  it('renvoie undefined quand l évaluation échoue', () => {
    expect(evaluate({ inconnu: [1] }, {})).toBeUndefined();
  });

  it('applique la véracité json-logic', () => {
    expect(truthy([])).toBe(false);
    expect(truthy('0')).toBe(true);
  });
});

describe('outils numériques', () => {
  it('convertit en nombre fini', () => {
    expect(toNumber(3)).toBe(3);
    expect(toNumber(Number.NaN)).toBeNull();
    expect(toNumber(' 4.5 ')).toBe(4.5);
    expect(toNumber('')).toBeNull();
    expect(toNumber('abc')).toBeNull();
    expect(toNumber(true)).toBeNull();
  });

  it('arrondit sans erreur binaire', () => {
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(-1.005, 2)).toBe(-1.01);
    expect(roundTo(1234.5, 0)).toBe(1235);
  });

  it('détecte les valeurs vides', () => {
    expect([undefined, null, '', []].every(isEmpty)).toBe(true);
    expect([0, false, ' ', [0]].some(isEmpty)).toBe(false);
  });
});

describe('inspection des expressions', () => {
  it('liste les variables lues', () => {
    expect(
      inspectLogic({ and: [{ '==': [{ var: 'a' }, 1] }, { var: ['b', 0] }, 'litteral'] }),
    ).toEqual({ vars: ['a', 'b'], issues: [] });
  });

  it('signale opérateurs interdits, objets à plusieurs clés et var invalides', () => {
    expect(
      inspectLogic([{ map: [] }, { a: 1, b: 2 }, { var: '' }, { var: [3] }] as never).issues,
    ).toEqual([
      { kind: 'unknown_operator', detail: 'map' },
      { kind: 'unknown_operator', detail: 'objet à plusieurs clés' },
      { kind: 'invalid_var', detail: '""' },
      { kind: 'invalid_var', detail: '[3]' },
    ]);
  });
});

describe('dates', () => {
  const instant = new Date('2026-10-18T23:30:00Z');

  it('donne le jour et l heure dans un fuseau', () => {
    expect(dayIn(instant, 'Africa/Abidjan')).toBe('2026-10-18');
    expect(dayIn(instant, 'Asia/Tokyo')).toBe('2026-10-19');
    expect(timeIn(instant, 'Africa/Abidjan')).toBe('23:30');
    expect(timeIn(new Date('2026-10-18T00:05:00Z'), 'Africa/Abidjan')).toBe('00:05');
  });

  it('numérote les jours et refuse les dates invalides', () => {
    expect(dayNumber('1970-01-02')).toBe(1);
    expect(dayNumber('2026-10-18T10:00:00Z')).toBe(dayNumber('2026-10-18'));
    expect(dayNumber('2026-02-30')).toBeNull();
    expect(dayNumber('18/10/2026')).toBeNull();
    expect(dayNumber(20261018)).toBeNull();
    expect(formatDay(1)).toBe('1970-01-02');
  });
});
