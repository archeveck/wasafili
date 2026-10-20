import { type Field, type FileRef, type GeoPoint, type Workflow } from '@wasafili/form-schema';

/** Fuseau d'affichage par défaut (D14). */
export const DEFAULT_TIME_ZONE = 'Africa/Abidjan';

export function formatDateTime(value: string | Date, timeZone = DEFAULT_TIME_ZONE) {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(value));
}

export function formatDate(value: string, timeZone = DEFAULT_TIME_ZONE) {
  // Une date calendaire (AAAA-MM-JJ) n'a pas de fuseau : l'afficher telle quelle.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-');
    return `${d}/${m}/${y}`;
  }
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeZone }).format(new Date(value));
}

/** Libellé d'un état de workflow (clé brute si inconnue). */
export function stateLabel(workflow: Workflow | undefined, state: string | null) {
  return workflow?.states.find((s) => s.key === state)?.label ?? state ?? '—';
}

/**
 * Valeur lisible d'un champ (tableau de fiches, historique), identique sur le web et le mobile.
 * `labels` : libellés des éléments de référentiel ; `users` : noms des utilisateurs connus.
 */
export function displayValue(
  field: Field | undefined,
  value: unknown,
  labels: ReadonlyMap<string, string>,
  timeZone: string,
  users: ReadonlyMap<string, string> = new Map(),
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
