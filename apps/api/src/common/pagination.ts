import { z } from 'zod';

/** Convention de pagination de l'API : `?page=1&per_page=25` (max 100). */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(25),
});

export type Pagination = z.infer<typeof paginationSchema>;

export interface Page<T> {
  data: T[];
  meta: { page: number; perPage: number; total: number; totalPages: number };
}

export function pageArgs({ page, per_page }: Pagination): { skip: number; take: number } {
  return { skip: (page - 1) * per_page, take: per_page };
}

export function toPage<T>(data: T[], total: number, { page, per_page }: Pagination): Page<T> {
  return {
    data,
    meta: { page, perPage: per_page, total, totalPages: Math.ceil(total / per_page) },
  };
}
