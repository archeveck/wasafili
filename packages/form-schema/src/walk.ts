import { type Field, NON_VALUE_TYPES, type SectionField, type TableField } from './fields.js';

export interface FieldEntry {
  field: Field;
  /** Section englobante (regroupement visuel). */
  section?: SectionField;
  /** Tableau répétable englobant : la valeur vit dans chaque ligne. */
  table?: TableField;
}

/** Parcourt tous les champs en profondeur (sections, tableaux), dans l'ordre d'affichage. */
export function* walkFields(fields: readonly Field[]): Generator<FieldEntry> {
  for (const field of fields) {
    yield { field };
    if (field.type === 'section') {
      for (const child of field.fields) {
        yield { field: child, section: field };
        if (child.type === 'table') {
          for (const cell of child.fields) yield { field: cell, section: field, table: child };
        }
      }
    } else if (field.type === 'table') {
      for (const cell of field.fields) yield { field: cell, table: field };
    }
  }
}

/** Champs portant une valeur au niveau racine des données (sections aplaties). */
export function rootValueFields(fields: readonly Field[]): Field[] {
  return [...walkFields(fields)]
    .filter(({ field, table }) => !table && !NON_VALUE_TYPES.has(field.type))
    .map(({ field }) => field);
}

export function hasValue(field: Field): boolean {
  return !NON_VALUE_TYPES.has(field.type);
}
