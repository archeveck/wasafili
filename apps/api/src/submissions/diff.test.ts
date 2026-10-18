import { describe, expect, it } from 'vitest';
import { diffData, jsonEqual } from './diff';

describe('jsonEqual', () => {
  it('compare en profondeur sans tenir compte de l ordre des clés', () => {
    expect(jsonEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
    expect(jsonEqual([1], { 0: 1 })).toBe(false);
    expect(jsonEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it('assimile absent et null', () => {
    expect(jsonEqual(undefined, null)).toBe(true);
    expect(jsonEqual({ a: null }, {})).toBe(true);
    expect(jsonEqual(0, null)).toBe(false);
  });
});

describe('diffData', () => {
  it('liste les champs modifiés, ajoutés et retirés, triés', () => {
    expect(diffData({ b: 1, a: 'x', c: [1] }, { a: 'y', c: [1], d: true })).toEqual([
      { field: 'a', before: 'x', after: 'y' },
      { field: 'b', before: 1, after: null },
      { field: 'd', before: null, after: true },
    ]);
  });
});
