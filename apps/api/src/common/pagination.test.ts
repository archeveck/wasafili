import { describe, expect, it } from 'vitest';
import { pageArgs, paginationSchema, toPage } from './pagination';

describe('pagination', () => {
  it('applique les valeurs par défaut et convertit les chaînes', () => {
    expect(paginationSchema.parse({})).toEqual({ page: 1, per_page: 25 });
    expect(paginationSchema.parse({ page: '3', per_page: '10' })).toEqual({
      page: 3,
      per_page: 10,
    });
  });

  it('borne per_page à 100', () => {
    expect(paginationSchema.safeParse({ per_page: '101' }).success).toBe(false);
  });

  it('calcule skip/take et les métadonnées', () => {
    expect(pageArgs({ page: 3, per_page: 10 })).toEqual({ skip: 20, take: 10 });
    expect(toPage(['a'], 21, { page: 3, per_page: 10 }).meta).toEqual({
      page: 3,
      perPage: 10,
      total: 21,
      totalPages: 3,
    });
  });
});
