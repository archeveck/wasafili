export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

/** Égalité structurelle de valeurs JSON (l'ordre des clés d'objet est indifférent). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return (a ?? null) === (b ?? null);
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => jsonEqual(item, b[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every((key) => jsonEqual(left[key], right[key]));
}

/** Modifications champ par champ entre deux états des données (audit trail, D11). */
export function diffData(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): FieldChange[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return keys
    .filter((key) => !jsonEqual(before[key], after[key]))
    .map((key) => ({ field: key, before: before[key] ?? null, after: after[key] ?? null }));
}
