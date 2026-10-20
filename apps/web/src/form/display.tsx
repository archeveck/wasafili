import { useQuery } from '@tanstack/react-query';
import { type Field, type FileRef, type GeoPoint } from '@wasafili/form-schema';
import { type AppClient } from '@wasafili/sdk';
import { formatDate, formatDateTime } from '@/lib/utils';

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

/** Valeur lisible d'un champ (tableau de fiches, historique). */
export function displayValue(
  field: Field | undefined,
  value: unknown,
  labels: Map<string, string>,
  timeZone: string,
  users: Map<string, string> = new Map(),
): string {
  if (value === null || value === undefined || value === '') return '—';
  if (!field) return typeof value === 'object' ? JSON.stringify(value) : String(value);
  switch (field.type) {
    case 'select':
      return field.options.find((o) => o.value === value)?.label ?? String(value);
    case 'multiselect':
      return (value as string[])
        .map((v) => field.options.find((o) => o.value === v)?.label ?? v)
        .join(', ');
    case 'list':
      return labels.get(String(value)) ?? '…';
    case 'boolean':
      return value ? 'Oui' : 'Non';
    case 'date':
      return formatDate(String(value), timeZone);
    case 'datetime':
    case 'timestamp':
      return formatDateTime(String(value), timeZone);
    case 'number':
      return `${new Intl.NumberFormat('fr-FR').format(value as number)}${field.unit ? ` ${field.unit}` : ''}`;
    case 'calculated':
      if (field.resultType === 'number')
        return new Intl.NumberFormat('fr-FR').format(value as number);
      if (field.resultType === 'boolean') return value ? 'Oui' : 'Non';
      if (field.resultType === 'date') return formatDate(String(value), timeZone);
      return String(value);
    case 'photo':
    case 'file':
      return `${(value as FileRef[]).length} fichier(s)`;
    case 'signature':
      return 'Signée';
    case 'geolocation': {
      const point = value as GeoPoint;
      return `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
    }
    case 'table':
      return `${(value as unknown[]).length} ligne(s)`;
    case 'rating':
      return '★'.repeat(value as number);
    case 'author':
    case 'user':
      return (Array.isArray(value) ? value : [value])
        .map((id) => users.get(String(id)) ?? 'Utilisateur')
        .join(', ');
    default:
      return Array.isArray(value) ? value.join(', ') : String(value);
  }
}
