import {
  type Field,
  type FieldType,
  type JsonLogic,
  type SectionField,
  type StructureDefinition,
  type TableField,
  walkFields,
} from '@tesserax/form-schema';
import { slugify } from '@/lib/utils';

/** Conteneur d'un champ : racine, section ou tableau (identifiés par l'`id` du champ). */
export const ROOT = 'root';

export interface PaletteEntry {
  type: FieldType;
  label: string;
  group: 'Saisie' | 'Choix' | 'Terrain' | 'Calcul et auto' | 'Mise en page';
}

/** Palette du designer (P2.3.1), dans l'ordre d'affichage. */
export const PALETTE: PaletteEntry[] = [
  { type: 'text', label: 'Texte court', group: 'Saisie' },
  { type: 'textarea', label: 'Texte long', group: 'Saisie' },
  { type: 'number', label: 'Nombre', group: 'Saisie' },
  { type: 'date', label: 'Date', group: 'Saisie' },
  { type: 'time', label: 'Heure', group: 'Saisie' },
  { type: 'datetime', label: 'Date et heure', group: 'Saisie' },
  { type: 'email', label: 'E-mail', group: 'Saisie' },
  { type: 'phone', label: 'Téléphone', group: 'Saisie' },
  { type: 'boolean', label: 'Oui / Non', group: 'Choix' },
  { type: 'select', label: 'Choix unique', group: 'Choix' },
  { type: 'multiselect', label: 'Choix multiple', group: 'Choix' },
  { type: 'list', label: 'Référentiel', group: 'Choix' },
  { type: 'relation', label: 'Lien vers une fiche', group: 'Choix' },
  { type: 'user', label: 'Utilisateur', group: 'Choix' },
  { type: 'rating', label: 'Note', group: 'Choix' },
  { type: 'slider', label: 'Curseur', group: 'Choix' },
  { type: 'photo', label: 'Photos', group: 'Terrain' },
  { type: 'file', label: 'Fichier', group: 'Terrain' },
  { type: 'signature', label: 'Signature', group: 'Terrain' },
  { type: 'geolocation', label: 'Géolocalisation', group: 'Terrain' },
  { type: 'barcode', label: 'Code-barres / QR', group: 'Terrain' },
  { type: 'calculated', label: 'Calcul', group: 'Calcul et auto' },
  { type: 'timestamp', label: 'Horodatage auto', group: 'Calcul et auto' },
  { type: 'author', label: 'Auteur auto', group: 'Calcul et auto' },
  { type: 'hidden', label: 'Champ caché', group: 'Calcul et auto' },
  { type: 'section', label: 'Section', group: 'Mise en page' },
  { type: 'table', label: 'Tableau répétable', group: 'Mise en page' },
  { type: 'info', label: 'Texte informatif', group: 'Mise en page' },
];

export const typeLabel = (type: FieldType) =>
  PALETTE.find((entry) => entry.type === type)?.label ?? type;

export function allKeys(definition: StructureDefinition): Set<string> {
  return new Set([...walkFields(definition.fields)].map(({ field }) => field.key));
}

export function uniqueKey(base: string, taken: Set<string>, ignore?: string): string {
  const root = slugify(base);
  let key = root;
  for (let i = 2; taken.has(key) && key !== ignore; i++) key = `${root}_${i}`;
  return key;
}

/** Nouveau champ avec des réglages par défaut valides. */
export function createField(
  type: FieldType,
  definition: StructureDefinition,
  newId: () => string,
): Field {
  const label = typeLabel(type);
  const base = { id: newId(), key: uniqueKey(label, allKeys(definition)), label };
  switch (type) {
    case 'select':
    case 'multiselect':
      return {
        ...base,
        type,
        options: [
          { value: 'option_1', label: 'Option 1' },
          { value: 'option_2', label: 'Option 2' },
        ],
      };
    case 'list':
      return { ...base, type, listId: '' };
    case 'relation':
      return { ...base, type, structureId: '' };
    case 'slider':
      return { ...base, type, min: 0, max: 100, step: 1 };
    case 'calculated':
      return { ...base, type, formula: '0', resultType: 'number' };
    case 'timestamp':
      return { ...base, type, mode: 'created' };
    case 'info':
      return { ...base, type, content: 'Texte d’aide affiché dans le formulaire.' };
    case 'section':
      return { ...base, type, fields: [] };
    case 'table':
      return {
        ...base,
        type,
        fields: [
          {
            id: newId(),
            key: uniqueKey(`${label} colonne`, allKeys(definition)),
            label: 'Colonne 1',
            type: 'text',
          },
        ],
      };
    default:
      return { ...base, type } as Field;
  }
}

/** Champs directs d'un conteneur. */
export function childrenOf(definition: StructureDefinition, container: string): Field[] {
  if (container === ROOT) return definition.fields;
  const found = findField(definition, container);
  return found && (found.field.type === 'section' || found.field.type === 'table')
    ? found.field.fields
    : [];
}

export function findField(definition: StructureDefinition, id: string) {
  for (const entry of walkFields(definition.fields)) {
    if (entry.field.id === id) {
      const container = entry.table?.id ?? entry.section?.id ?? ROOT;
      return { ...entry, container };
    }
  }
  return undefined;
}

/** Un champ de ce type peut-il aller dans ce conteneur ? (sections à la racine, pas de tableau dans un tableau.) */
export function canContain(
  definition: StructureDefinition,
  container: string,
  type: FieldType,
): boolean {
  if (container === ROOT) return true;
  const target = findField(definition, container)?.field;
  if (target?.type === 'section') return type !== 'section';
  if (target?.type === 'table') return type !== 'section' && type !== 'table';
  return false;
}

function mapContainers(
  fields: Field[],
  container: string,
  update: (fields: Field[]) => Field[],
): Field[] {
  return fields.map((field) => {
    if (field.type !== 'section' && field.type !== 'table') return field;
    if (field.id === container)
      return { ...field, fields: update(field.fields as Field[]) } as Field;
    if (field.type === 'section')
      return {
        ...field,
        fields: mapContainers(field.fields as Field[], container, update),
      } as SectionField;
    return field;
  });
}

function updateContainer(
  definition: StructureDefinition,
  container: string,
  update: (fields: Field[]) => Field[],
): StructureDefinition {
  if (container === ROOT) return { ...definition, fields: update(definition.fields) };
  return { ...definition, fields: mapContainers(definition.fields, container, update) };
}

export function insertField(
  definition: StructureDefinition,
  field: Field,
  container: string,
  index?: number,
): StructureDefinition {
  if (!canContain(definition, container, field.type)) return definition;
  return updateContainer(definition, container, (fields) => {
    const next = [...fields];
    next.splice(index ?? next.length, 0, field);
    return next;
  });
}

export function removeField(definition: StructureDefinition, id: string): StructureDefinition {
  const found = findField(definition, id);
  if (!found) return definition;
  return updateContainer(definition, found.container, (fields) =>
    fields.filter((f) => f.id !== id),
  );
}

export function updateField(
  definition: StructureDefinition,
  id: string,
  patch: Partial<Field>,
): StructureDefinition {
  const found = findField(definition, id);
  if (!found) return definition;
  return updateContainer(definition, found.container, (fields) =>
    fields.map((field) => (field.id === id ? ({ ...field, ...patch } as Field) : field)),
  );
}

/** Déplace un champ vers un conteneur et une position, si les règles d'imbrication l'autorisent. */
export function moveField(
  definition: StructureDefinition,
  id: string,
  container: string,
  index: number,
): StructureDefinition {
  const found = findField(definition, id);
  if (!found || container === id || !canContain(definition, container, found.field.type))
    return definition;
  // Interdit de déposer une section ou un tableau dans un de ses propres descendants.
  if (findField(definition, container) && isDescendant(found.field, container)) return definition;
  const without = removeField(definition, id);
  const sameContainer = found.container === container;
  const from = childrenOf(definition, container).findIndex((f) => f.id === id);
  const target = sameContainer && from !== -1 && from < index ? index - 1 : index;
  return insertField(without, found.field, container, target);
}

function isDescendant(field: Field, id: string): boolean {
  if (field.type !== 'section' && field.type !== 'table') return false;
  return (field.fields as Field[]).some((child) => child.id === id || isDescendant(child, id));
}

export interface DefinitionDiff {
  added: Field[];
  removed: Field[];
  changed: { before: Field; after: Field }[];
  workflowChanged: boolean;
}

/** Différences entre la version publiée et le brouillon, par clé de champ (P2.3.5). */
export function diffDefinitions(
  before: StructureDefinition | undefined,
  after: StructureDefinition,
): DefinitionDiff {
  const index = (definition: StructureDefinition | undefined) =>
    new Map(
      [...walkFields(definition?.fields ?? [])].map(({ field }) => {
        // Le contenu d'une section ou d'un tableau est comparé champ par champ.
        const own =
          field.type === 'section' || field.type === 'table' ? { ...field, fields: [] } : field;
        return [field.key, own as Field];
      }),
    );
  const left = index(before);
  const right = index(after);
  return {
    added: [...right.values()].filter((field) => !left.has(field.key)),
    removed: [...left.values()].filter((field) => !right.has(field.key)),
    changed: [...right.values()]
      .filter(
        (field) =>
          left.has(field.key) && JSON.stringify(left.get(field.key)) !== JSON.stringify(field),
      )
      .map((field) => ({ before: left.get(field.key)!, after: field })),
    workflowChanged:
      JSON.stringify(before?.workflow ?? null) !== JSON.stringify(after.workflow ?? null),
  };
}

// --- Éditeur visuel de conditions (P2.3.3) ------------------------------------------------

export type ConditionOperator = '==' | '!=' | '>' | '>=' | '<' | '<=' | 'empty' | 'filled' | 'in';

export interface ConditionRule {
  /** Variable json-logic : `cle` ou `$row.colonne`. */
  variable: string;
  operator: ConditionOperator;
  value: string;
}

export interface ConditionModel {
  combinator: 'and' | 'or';
  rules: ConditionRule[];
}

export const CONDITION_OPERATORS: { value: ConditionOperator; label: string; unary?: boolean }[] = [
  { value: '==', label: 'est égal à' },
  { value: '!=', label: 'est différent de' },
  { value: 'in', label: 'est parmi (séparés par ,)' },
  { value: '>', label: 'est supérieur à' },
  { value: '>=', label: 'est supérieur ou égal à' },
  { value: '<', label: 'est inférieur à' },
  { value: '<=', label: 'est inférieur ou égal à' },
  { value: 'empty', label: 'est vide', unary: true },
  { value: 'filled', label: 'est renseigné', unary: true },
];

/** Valeur saisie → valeur JSON : nombre ou booléen si la saisie en a la forme. */
function literal(value: string): JsonLogic {
  const trimmed = value.trim();
  if (trimmed === 'true' || trimmed === 'false') return trimmed === 'true';
  if (trimmed !== '' && !Number.isNaN(Number(trimmed))) return Number(trimmed);
  return value;
}

function ruleToLogic(rule: ConditionRule): JsonLogic {
  const variable = { var: rule.variable };
  switch (rule.operator) {
    case 'empty':
      return { empty: [variable] };
    case 'filled':
      return { '!': [{ empty: [variable] }] };
    case 'in':
      return { in_list: [variable, rule.value.split(',').map((v) => literal(v.trim()))] };
    default:
      return { [rule.operator]: [variable, literal(rule.value)] };
  }
}

/** Modèle visuel → json-logic ; `undefined` si aucune règle. */
export function conditionToLogic(model: ConditionModel): Record<string, JsonLogic> | undefined {
  const rules = model.rules.filter((rule) => rule.variable);
  if (rules.length === 0) return undefined;
  if (rules.length === 1) return ruleToLogic(rules[0]!) as Record<string, JsonLogic>;
  return { [model.combinator]: rules.map(ruleToLogic) };
}

const display = (value: JsonLogic) => (typeof value === 'string' ? value : JSON.stringify(value));

function logicToRule(logic: JsonLogic): ConditionRule | undefined {
  if (!logic || typeof logic !== 'object' || Array.isArray(logic)) return undefined;
  const [operator, args] = Object.entries(logic)[0] ?? [];
  if (!operator || !Array.isArray(args)) return undefined;
  const variableOf = (node: JsonLogic) =>
    node && typeof node === 'object' && !Array.isArray(node) && typeof node['var'] === 'string'
      ? (node['var'] as string)
      : undefined;
  if (operator === 'empty') {
    const variable = variableOf(args[0]!);
    return variable ? { variable, operator: 'empty', value: '' } : undefined;
  }
  if (operator === '!') {
    const inner = logicToRule(args[0]!);
    return inner?.operator === 'empty' ? { ...inner, operator: 'filled' } : undefined;
  }
  if (operator === 'in_list' && Array.isArray(args[1])) {
    const variable = variableOf(args[0]!);
    return variable
      ? { variable, operator: 'in', value: (args[1] as JsonLogic[]).map(display).join(', ') }
      : undefined;
  }
  if (CONDITION_OPERATORS.some((op) => op.value === operator) && args.length === 2) {
    const variable = variableOf(args[0]!);
    const value = args[1]!;
    if (variable && (value === null || typeof value !== 'object')) {
      return {
        variable,
        operator: operator as ConditionOperator,
        value: value === null ? '' : display(value),
      };
    }
  }
  return undefined;
}

/** json-logic → modèle visuel ; `undefined` si l'expression est trop complexe (mode avancé). */
export function logicToCondition(
  logic: Record<string, JsonLogic> | undefined,
): ConditionModel | undefined {
  if (!logic) return { combinator: 'and', rules: [] };
  const [operator, args] = Object.entries(logic)[0] ?? [];
  if ((operator === 'and' || operator === 'or') && Array.isArray(args)) {
    const rules = args.map(logicToRule);
    return rules.every(Boolean)
      ? { combinator: operator, rules: rules as ConditionRule[] }
      : undefined;
  }
  const rule = logicToRule(logic);
  return rule ? { combinator: 'and', rules: [rule] } : undefined;
}

export type { SectionField, TableField };
