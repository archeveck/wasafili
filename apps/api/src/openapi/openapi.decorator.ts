import { SetMetadata } from '@nestjs/common';
import { type z } from 'zod';

export const OPENAPI = 'tesserax:openapi';

/** Paramètre OpenAPI écrit à la main (ex. filtres `filter[cle][op]`, hors schéma Zod). */
export interface ParameterObject {
  name: string;
  in: 'query' | 'path' | 'header';
  description?: string;
  required?: boolean;
  style?: string;
  explode?: boolean;
  schema: Record<string, unknown>;
}

/**
 * Compléments de documentation d'une route (P7.1.2). Le chemin, la méthode, les paramètres,
 * le corps validé par Zod, les permissions et les codes d'erreur sont lus sur la route
 * elle-même ; ce décorateur ne décrit que ce que le code ne dit pas.
 * Les schémas de réponse doivent être enregistrés dans `resources` (composants nommés).
 */
export interface OpenApiOptions {
  /** Réponse : la ressource elle-même. */
  response?: z.ZodType;
  /** Réponse : liste paginée `{ data: [ressource], meta }`. */
  page?: z.ZodType;
  /** Réponse : liste non paginée `{ data: [ressource] }`. */
  list?: z.ZodType;
  /** Réponse binaire (téléchargement) : types MIME possibles. */
  produces?: string[];
  /** Corps lu sans pipe Zod (endpoint OAuth). */
  body?: z.ZodType;
  /** Types de contenu acceptés pour le corps (défaut : JSON). */
  consumes?: string[];
  /** Corps multipart : nom du champ fichier. */
  upload?: string;
  /** Paramètres supplémentaires. */
  parameters?: ParameterObject[];
}

export const OpenApi = (options: OpenApiOptions) => SetMetadata(OPENAPI, options);

/** Filtres de fiches : `filter[cle]=v` ou `filter[cle][op]=v` (ADR 0004). */
export const SUBMISSION_FILTERS: ParameterObject = {
  name: 'filter',
  in: 'query',
  style: 'deepObject',
  explode: true,
  description:
    'Filtres sur les champs filtrables : `filter[cle]=valeur` (égalité) ou ' +
    '`filter[cle][op]=valeur` avec `op` parmi `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in` ' +
    '(valeurs séparées par des virgules), `contains`.',
  schema: {
    type: 'object',
    additionalProperties: {
      anyOf: [
        { type: 'string' },
        {
          type: 'object',
          propertyNames: { enum: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'contains'] },
          additionalProperties: { type: 'string' },
        },
      ],
    },
  },
};
