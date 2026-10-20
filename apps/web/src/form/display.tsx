import { useQuery } from '@tanstack/react-query';
import { type Field } from '@wasafili/form-schema';
import { type AppClient } from '@wasafili/sdk';

/** Libellés des éléments de référentiel référencés (une requête pour toute la page). */
export function useItemLabels(api: AppClient, short: string, ids: string[]) {
  const unique = [...new Set(ids)].sort();
  const query = useQuery({
    queryKey: [short, 'item-labels', unique],
    queryFn: () => api.lists.byIds(unique),
    enabled: unique.length > 0,
    staleTime: 5 * 60_000,
  });
  return new Map((query.data?.data ?? []).map((item) => [item.id, item.label]));
}

/** Noms des membres de l'instance (colonnes auteur / utilisateur) ; vide sans droit de lecture. */
export function useUserLabels(api: AppClient, short: string) {
  const users = useQuery({
    queryKey: [short, 'user-labels'],
    queryFn: () => api.users.list({ perPage: 100 }).catch(() => ({ data: [] })),
    staleTime: 5 * 60_000,
  });
  return new Map((users.data?.data ?? []).map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
}

export function listItemIds(fields: Field[], rows: Record<string, unknown>[]) {
  return rows.flatMap((row) =>
    fields
      .filter((f) => f.type === 'list' && typeof row[f.key] === 'string')
      .map((f) => row[f.key] as string),
  );
}

/** Valeur lisible d'un champ : partagée avec le mobile. */
export { displayValue } from '@wasafili/form-renderer';
