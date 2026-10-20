import { type Field, rootValueFields, type StructureDefinition } from '@wasafili/form-schema';

/** Valeur lisible d'un champ pour l'export tableur (P2.5.4). */
export function formatCell(
  field: Field,
  value: unknown,
  labels: { items: Map<string, string>; users: Map<string, string> },
): string {
  if (value === null || value === undefined) return '';
  switch (field.type) {
    case 'select':
      return field.options.find((option) => option.value === value)?.label ?? String(value);
    case 'multiselect':
      return (value as string[])
        .map((item) => field.options.find((option) => option.value === item)?.label ?? item)
        .join(', ');
    case 'list':
      return labels.items.get(String(value)) ?? String(value);
    case 'user':
    case 'author':
      return (Array.isArray(value) ? value : [value])
        .map((id) => labels.users.get(String(id)) ?? String(id))
        .join(', ');
    case 'boolean':
      return value ? 'Oui' : 'Non';
    case 'geolocation': {
      const point = value as { lat: number; lng: number };
      return `${point.lat}, ${point.lng}`;
    }
    case 'photo':
    case 'file':
    case 'table':
      return String((value as unknown[]).length);
    case 'signature':
      return 'Signée';
    case 'calculated':
      return typeof value === 'boolean' ? (value ? 'Oui' : 'Non') : String(value);
    default:
      return Array.isArray(value) ? value.join(', ') : String(value);
  }
}

export function exportColumns(definition: StructureDefinition): Field[] {
  return rootValueFields(definition.fields);
}

/** Identifiants d'éléments de référentiel et d'utilisateurs à résoudre en libellés. */
export function referencedIds(fields: Field[], rows: Record<string, unknown>[]) {
  const items = new Set<string>();
  const users = new Set<string>();
  for (const row of rows) {
    for (const field of fields) {
      const value = row[field.key];
      if (value === null || value === undefined) continue;
      if (field.type === 'list') items.add(String(value));
      if (field.type === 'user' || field.type === 'author') {
        for (const id of Array.isArray(value) ? value : [value]) users.add(String(id));
      }
    }
  }
  return { items: [...items], users: [...users] };
}
