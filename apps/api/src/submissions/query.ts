import { BadRequestException } from '@nestjs/common';
import { type Field, rootValueFields, type StructureDefinition } from '@wasafili/form-schema';
import { Prisma } from '../generated/prisma/client';

export const FILTER_OPERATORS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'contains'] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export interface Filter {
  key: string;
  operator: FilterOperator;
  value: string;
}

export type Kind = 'text' | 'number' | 'boolean' | 'array';

const invalid = (message: string) => new BadRequestException({ error: 'invalid_filter', message });

/**
 * Lit les filtres `filter[cle]=v` et `filter[cle][op]=v`, que la chaîne de requête soit
 * décodée à plat (`'filter[cle]'`) ou en objet (`{ filter: { cle: … } }`).
 */
export function parseFilters(query: Record<string, unknown>): Filter[] {
  const filters: Filter[] = [];
  const add = (key: string, operator: string, value: unknown) => {
    if (!(FILTER_OPERATORS as readonly string[]).includes(operator)) {
      throw invalid(`Opérateur de filtre inconnu : ${operator}`);
    }
    if (typeof value !== 'string') throw invalid(`Valeur de filtre invalide pour ${key}`);
    filters.push({ key, operator: operator as FilterOperator, value });
  };
  for (const [name, value] of Object.entries(query)) {
    const flat = /^filter\[([^\]]+)\](?:\[([^\]]+)\])?$/.exec(name);
    if (flat) add(flat[1]!, flat[2] ?? 'eq', value);
  }
  const nested = query['filter'];
  if (nested && typeof nested === 'object') {
    for (const [key, value] of Object.entries(nested)) {
      if (value && typeof value === 'object') {
        for (const [operator, operand] of Object.entries(value)) add(key, operator, operand);
      } else add(key, 'eq', value);
    }
  }
  return filters;
}

function kindOf(field: Field): Kind | undefined {
  switch (field.type) {
    case 'number':
    case 'rating':
    case 'slider':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'multiselect':
      return 'array';
    case 'user':
    case 'relation':
      return field.multiple ? 'array' : 'text';
    case 'calculated':
      return field.resultType === 'number'
        ? 'number'
        : field.resultType === 'boolean'
          ? 'boolean'
          : 'text';
    case 'photo':
    case 'file':
    case 'signature':
    case 'geolocation':
    case 'table':
      return undefined;
    default:
      return 'text';
  }
}

/** Champs filtrables et triables de la définition, avec le type SQL de leur valeur. */
export function filterableFields(definition: StructureDefinition | undefined): Map<string, Kind> {
  const fields = new Map<string, Kind>();
  for (const field of rootValueFields(definition?.fields ?? [])) {
    const kind = kindOf(field);
    if (field.filterable && kind) fields.set(field.key, kind);
  }
  return fields;
}

/** Valeur numérique d'un champ (NULL si la valeur stockée n'est pas un nombre). */
export const numericValue = (key: string) =>
  Prisma.sql`(CASE WHEN jsonb_typeof(s.data -> ${key}) = 'number' THEN (s.data ->> ${key})::numeric END)`;

function toNumber(filter: Filter): number {
  const number = Number(filter.value);
  if (filter.value.trim() === '' || !Number.isFinite(number)) {
    throw invalid(`Nombre attendu pour ${filter.key}`);
  }
  return number;
}

const COMPARATORS = { gt: '>', gte: '>=', lt: '<', lte: '<=' } as const;

/** Traduit un filtre en condition SQL paramétrée sur `s.data` (alias `s` = submissions). */
export function filterSql(filter: Filter, fields: Map<string, Kind>): Prisma.Sql {
  const kind = fields.get(filter.key);
  if (!kind) throw invalid(`Champ non filtrable : ${filter.key}`);
  const { key, operator, value } = filter;
  const list = value.split(',').map((item) => item.trim());

  if (kind === 'boolean') {
    if (value !== 'true' && value !== 'false') throw invalid(`Booléen attendu pour ${key}`);
    const contains = Prisma.sql`s.data @> jsonb_build_object(${key}::text, ${value === 'true'}::boolean)`;
    if (operator === 'eq') return contains;
    if (operator === 'ne') return Prisma.sql`NOT (${contains})`;
  } else if (kind === 'array') {
    if (operator === 'eq' || operator === 'contains') {
      return Prisma.sql`s.data @> jsonb_build_object(${key}::text, jsonb_build_array(${value}::text))`;
    }
    if (operator === 'in') return Prisma.sql`jsonb_exists_any(s.data -> ${key}, ${list}::text[])`;
  } else if (kind === 'number') {
    if (operator === 'eq') {
      return Prisma.sql`s.data @> jsonb_build_object(${key}::text, ${toNumber(filter)}::numeric)`;
    }
    if (operator === 'ne')
      return Prisma.sql`${numericValue(key)} IS DISTINCT FROM ${toNumber(filter)}`;
    if (operator === 'in') {
      const numbers = list.map((item) => toNumber({ ...filter, value: item }));
      return Prisma.sql`${numericValue(key)} = ANY(${numbers}::numeric[])`;
    }
    if (operator in COMPARATORS) {
      const comparator = Prisma.raw(COMPARATORS[operator as keyof typeof COMPARATORS]);
      return Prisma.sql`${numericValue(key)} ${comparator} ${toNumber(filter)}`;
    }
  } else {
    const text = Prisma.sql`(s.data ->> ${key})`;
    if (operator === 'eq') {
      // Containment : servi par l'index GIN (jsonb_path_ops).
      return Prisma.sql`s.data @> jsonb_build_object(${key}::text, ${value}::text)`;
    }
    if (operator === 'ne') return Prisma.sql`${text} IS DISTINCT FROM ${value}`;
    if (operator === 'in') return Prisma.sql`${text} = ANY(${list}::text[])`;
    if (operator === 'contains') {
      const pattern = `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
      return Prisma.sql`${text} ILIKE ${pattern}`;
    }
    const comparator = Prisma.raw(COMPARATORS[operator as keyof typeof COMPARATORS]);
    return Prisma.sql`${text} ${comparator} ${value}`;
  }
  throw invalid(`Opérateur ${operator} non applicable au champ ${key}`);
}

const BUILTIN_SORTS: Record<string, string> = {
  createdAt: 's.created_at',
  updatedAt: 's.updated_at',
  state: 's.state',
};

/** `sort=createdAt`, `sort=-updatedAt`, `sort=-cle_de_champ` (champ filtrable). */
export function orderSql(sort: string | undefined, fields: Map<string, Kind>): Prisma.Sql {
  const raw = sort?.trim() || '-createdAt';
  const descending = raw.startsWith('-');
  const name = descending ? raw.slice(1) : raw;
  const direction = Prisma.raw(descending ? 'DESC NULLS LAST' : 'ASC NULLS LAST');
  const builtin = BUILTIN_SORTS[name];
  if (builtin) return Prisma.sql`${Prisma.raw(builtin)} ${direction}`;

  const kind = fields.get(name);
  if (kind === 'number') return Prisma.sql`${numericValue(name)} ${direction}`;
  if (kind === 'text' || kind === 'boolean') {
    return Prisma.sql`(s.data ->> ${name}) ${direction}`;
  }
  throw invalid(`Tri impossible sur : ${name}`);
}
