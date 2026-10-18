/** Import / export de référentiels hiérarchiques (P1.5.3, P1.5.4) — logique pure. */

export interface LevelMapping {
  /** Colonne du libellé. */
  label: string;
  /** Colonne du code (facultatif). */
  code?: string;
  /** Attributs : nom de l'attribut → colonne. */
  attributes?: Record<string, string>;
}

export interface ExistingItem {
  id: string;
  parentId: string | null;
  level: number;
  code: string | null;
  label: string;
  attributes: Record<string, unknown>;
  archived: boolean;
  position: number;
}

export interface NewItem {
  id: string;
  parentId: string | null;
  level: number;
  code: string | null;
  label: string;
  attributes: Record<string, string>;
  position: number;
}

export interface ItemUpdate {
  id: string;
  label?: string;
  code?: string;
  attributes?: Record<string, unknown>;
  unarchive?: boolean;
}

export interface ImportError {
  /** Numéro de ligne du fichier (1 = en-tête) ; 0 pour une erreur de structure. */
  row: number;
  message: string;
}

export interface ImportPlan {
  creates: NewItem[];
  updates: ItemUpdate[];
  archives: string[];
  unchanged: number;
  errors: ImportError[];
}

export type ImportMode = 'merge' | 'replace';

const normalize = (value: string) => value.trim().toLocaleLowerCase('fr');

/**
 * Correspondance par défaut, symétrique de l'export : pour un niveau « Site », colonnes
 * `Site` (libellé), `Site code` et `Site.<attribut>`. Les en-têtes sont comparés sans casse.
 */
export function defaultMapping(levels: string[], headers: string[]): LevelMapping[] {
  const find = (name: string) => headers.find((header) => normalize(header) === normalize(name));
  const mapping: LevelMapping[] = [];
  for (const level of levels) {
    const label = find(level);
    if (!label) break;
    const code = find(`${level} code`);
    const prefix = normalize(`${level}.`);
    const attributes = Object.fromEntries(
      headers
        .filter((header) => normalize(header).startsWith(prefix))
        .map((header) => [header.trim().slice(prefix.length), header]),
    );
    mapping.push({
      label,
      ...(code ? { code } : {}),
      ...(Object.keys(attributes).length ? { attributes } : {}),
    });
  }
  return mapping;
}

/**
 * Planifie un import sans rien écrire. Un élément est reconnu par son code s'il en a un,
 * sinon par son libellé sous le même parent. Toute erreur rend le plan inapplicable
 * (import tout ou rien).
 */
export function planImport(input: {
  levels: string[];
  headers: string[];
  rows: Record<string, string>[];
  existing: ExistingItem[];
  mode: ImportMode;
  mapping?: LevelMapping[];
  newId: () => string;
}): ImportPlan {
  const plan: ImportPlan = { creates: [], updates: [], archives: [], unchanged: 0, errors: [] };
  const mapping = input.mapping ?? defaultMapping(input.levels, input.headers);
  if (mapping.length === 0) {
    plan.errors.push({ row: 0, message: `Colonne « ${input.levels[0]} » introuvable` });
    return plan;
  }
  if (mapping.length > input.levels.length) {
    plan.errors.push({
      row: 0,
      message: `Le référentiel n'a que ${input.levels.length} niveau(x)`,
    });
    return plan;
  }
  for (const level of mapping) {
    const columns = [level.label, level.code, ...Object.values(level.attributes ?? {})];
    for (const column of columns) {
      if (column !== undefined && !input.headers.includes(column)) {
        plan.errors.push({ row: 0, message: `Colonne « ${column} » introuvable` });
      }
    }
  }
  if (plan.errors.length) return plan;

  type Known = ExistingItem | NewItem;
  const byCode = new Map<string, Known>();
  const byParentLabel = new Map<string, Known>();
  const index = (item: Known) => {
    if (item.code) byCode.set(item.code, item);
    byParentLabel.set(`${item.parentId}|${normalize(item.label)}`, item);
  };
  input.existing.forEach(index);

  const existingIds = new Set(input.existing.map((item) => item.id));
  const pending = new Map<string, ItemUpdate>();
  const firstSeen = new Map<string, { label: string; row: number }>();
  const seen = new Set<string>();
  let position = Math.max(-1, ...input.existing.map((item) => item.position)) + 1;

  input.rows.forEach((row, rowIndex) => {
    const rowNumber = rowIndex + 2;
    let parentId: string | null = null;
    for (const [level, columns] of mapping.entries()) {
      const levelName = input.levels[level]!;
      const label = (row[columns.label] ?? '').trim();
      const code = columns.code ? (row[columns.code] ?? '').trim() : '';
      if (!label && !code) {
        // Fin du chemin… sauf si un niveau plus profond est renseigné : parent manquant.
        const orphan = mapping
          .slice(level + 1)
          .some(
            (deeper) =>
              (row[deeper.label] ?? '').trim() || (deeper.code && (row[deeper.code] ?? '').trim()),
          );
        if (orphan)
          plan.errors.push({ row: rowNumber, message: `${levelName} : libellé manquant` });
        return;
      }
      if (!label) {
        plan.errors.push({ row: rowNumber, message: `${levelName} : libellé manquant` });
        return;
      }
      const attributes = Object.fromEntries(
        Object.entries(columns.attributes ?? {})
          .map(([name, column]) => [name, (row[column] ?? '').trim()] as const)
          .filter(([, value]) => value !== ''),
      );

      let item: Known | undefined = code ? byCode.get(code) : undefined;
      if (!item) {
        const sameLabel = byParentLabel.get(`${parentId}|${normalize(label)}`);
        // Sans code dans le fichier, ou ajout d'un code à un élément qui n'en avait pas.
        if (sameLabel && (!code || !sameLabel.code)) item = sameLabel;
      }

      if (item) {
        if (item.parentId !== parentId) {
          plan.errors.push({
            row: rowNumber,
            message: `${levelName} « ${code || label} » : déjà rattaché à un autre parent (déplacement non pris en charge)`,
          });
          return;
        }
        const previous = firstSeen.get(item.id);
        if (previous && normalize(previous.label) !== normalize(label)) {
          plan.errors.push({
            row: rowNumber,
            message: `${levelName} « ${code} » : libellé différent de la ligne ${previous.row}`,
          });
          return;
        }
        firstSeen.set(item.id, { label, row: rowNumber });
        if (existingIds.has(item.id) && !seen.has(item.id)) {
          const existing = item as ExistingItem;
          const update: ItemUpdate = { id: item.id };
          if (existing.label !== label) update.label = label;
          if (code && !existing.code) update.code = code;
          const merged = { ...existing.attributes, ...attributes };
          if (JSON.stringify(merged) !== JSON.stringify(existing.attributes)) {
            update.attributes = merged;
          }
          if (existing.archived) update.unarchive = true;
          if (Object.keys(update).length > 1) pending.set(item.id, update);
        }
      } else {
        item = {
          id: input.newId(),
          parentId,
          level,
          code: code || null,
          label,
          attributes,
          position: position++,
        };
        plan.creates.push(item);
        firstSeen.set(item.id, { label, row: rowNumber });
        index(item);
      }
      seen.add(item.id);
      parentId = item.id;
    }
  });

  plan.updates = [...pending.values()];
  plan.unchanged = input.existing.filter(
    (item) => seen.has(item.id) && !pending.has(item.id),
  ).length;
  if (input.mode === 'replace') {
    plan.archives = input.existing
      .filter((item) => !item.archived && !seen.has(item.id))
      .map((item) => item.id);
  }
  return plan;
}

/** Une ligne par chemin racine → feuille (éléments actifs), colonnes symétriques de l'import. */
export function exportTable(
  levels: string[],
  items: ExistingItem[],
): { headers: string[]; rows: Record<string, string>[] } {
  const active = items.filter((item) => !item.archived);
  const children = new Map<string | null, ExistingItem[]>();
  for (const item of active) {
    children.set(item.parentId, [...(children.get(item.parentId) ?? []), item]);
  }
  for (const list of children.values()) {
    list.sort((a, b) => a.position - b.position || a.label.localeCompare(b.label, 'fr'));
  }

  const attributeNames = levels.map((_, level) =>
    [
      ...new Set(
        active
          .filter((item) => item.level === level)
          .flatMap((item) => Object.keys(item.attributes)),
      ),
    ].sort(),
  );
  const headers = levels.flatMap((level, index) => [
    `${level} code`,
    level,
    ...attributeNames[index]!.map((name) => `${level}.${name}`),
  ]);

  const rows: Record<string, string>[] = [];
  const walk = (item: ExistingItem, path: Record<string, string>) => {
    const level = levels[item.level]!;
    const row = { ...path, [`${level} code`]: item.code ?? '', [level]: item.label };
    for (const [name, value] of Object.entries(item.attributes)) {
      row[`${level}.${name}`] = String(value ?? '');
    }
    const kids = children.get(item.id) ?? [];
    if (kids.length === 0) rows.push(row);
    else kids.forEach((child) => walk(child, row));
  };
  (children.get(null) ?? []).forEach((root) => walk(root, {}));
  return { headers, rows };
}
