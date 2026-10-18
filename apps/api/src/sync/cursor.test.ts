import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, INITIAL_CURSOR, nextCursor } from './cursor';

describe('curseur de synchronisation', () => {
  it('fait l aller-retour et part du curseur initial', () => {
    expect(decodeCursor(undefined)).toEqual(INITIAL_CURSOR);
    const cursor = { ...INITIAL_CURSOR, structures: '42' };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('refuse un curseur corrompu', () => {
    expect(() => decodeCursor('pas-un-curseur')).toThrow(/resynchronisation/);
    expect(() => decodeCursor(Buffer.from('{"v":2}').toString('base64url'))).toThrow();
  });

  it('garde le plancher pendant une passe puis avance au début de passe', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    const page = nextCursor({ floor: '10' }, '50', { txid: '45', id }, true);
    expect(page).toEqual({ floor: '10', start: '50', pos: { txid: '45', id } });
    expect(nextCursor(page, '50', undefined, false)).toEqual({ floor: '50' });
  });
});
