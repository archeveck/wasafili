import { describe, expect, it } from 'vitest';
import { parseFields, selectFields } from './fields';

describe('parseFields', () => {
  it('découpe et nettoie la liste', () => {
    expect(parseFields(' email, name ,,')).toEqual(['email', 'name']);
  });

  it('ignore un paramètre absent, vide ou répété', () => {
    expect(parseFields(undefined)).toBeUndefined();
    expect(parseFields('')).toBeUndefined();
    expect(parseFields(['a', 'b'])).toBeUndefined();
  });
});

describe('selectFields', () => {
  const item = { id: '1', email: 'a@b.ci', name: 'A', secret: 'x' };

  it('filtre un objet en conservant id', () => {
    expect(selectFields(item, ['email'])).toEqual({ id: '1', email: 'a@b.ci' });
  });

  it('filtre les éléments d une page sans toucher aux métadonnées', () => {
    const page = { data: [item], meta: { page: 1, perPage: 25, total: 1, totalPages: 1 } };
    expect(selectFields(page, ['name'])).toEqual({
      data: [{ id: '1', name: 'A' }],
      meta: page.meta,
    });
  });

  it('ignore les champs inconnus et les valeurs non objets', () => {
    expect(selectFields(item, ['inconnu'])).toEqual({ id: '1' });
    expect(selectFields('texte', ['a'])).toBe('texte');
  });
});
