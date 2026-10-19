import { HttpStatus, RequestMethod, type Type } from '@nestjs/common';
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { ParseUUIDPipe } from '@nestjs/common';
import { z } from 'zod';
import { ANY_PERMISSIONS, IS_PUBLIC, REQUIRED_PERMISSIONS } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PERMISSIONS } from '../tenancy/permissions';
import { OPENAPI, type OpenApiOptions, type ParameterObject } from './openapi.decorator';
import { resources } from './resources';

type Json = Record<string, unknown>;

/** Commentaires JSDoc des contrôleurs : `Classe` et `Classe.méthode`. */
export type DocComments = ReadonlyMap<string, string>;

const HTTP_METHODS: Partial<Record<RequestMethod, string>> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.PATCH]: 'patch',
  [RequestMethod.DELETE]: 'delete',
};
const METHOD_ORDER = ['get', 'post', 'put', 'patch', 'delete'];

/** Sections publiques de la documentation, dans l'ordre de lecture d'un intégrateur. */
const TAGS: Record<string, [name: string, description: string]> = {
  OAuth: ['Authentification', 'Jetons OAuth2 : `client_credentials` pour les intégrations.'],
  Me: ['Appelant et instances', 'Identité de l’appelant et instances accessibles.'],
  Structures: ['Formulaires', 'Formulaires versionnés ; une version publiée est immuable.'],
  Submissions: [
    'Fiches',
    'Fiches saisies, filtres, workflow, historique et conflits. Les droits dépendent du formulaire.',
  ],
  Files: ['Fichiers', 'Dépôt direct par URL signée (photos, signatures, pièces jointes).'],
  Lists: ['Référentiels', 'Référentiels hiérarchiques, import et export CSV/XLSX.'],
  Tasks: ['Tâches', 'Fiches à saisir, planifiées et assignées.'],
  Reports: ['Rapports', 'Modèles DOCX et rapports PDF des fiches.'],
  Webhooks: ['Webhooks', 'Notifications sortantes signées (HMAC-SHA256).'],
  Automations: ['Automatisations', 'Déclencheurs, actions et journal d’exécution.'],
  Emails: ['E-mails', 'Journal des e-mails envoyés par les automatisations.'],
  PhotoExports: ['Exports de photos', 'Archives ZIP des photos d’une sélection de fiches.'],
  Dashboards: ['Tableaux de bord', 'Indicateurs calculés sur les fiches lisibles par l’appelant.'],
  Team: ['Équipes terrain', 'Dernières positions connues des membres.'],
  Users: ['Membres', 'Membres de l’instance, rôles et attributs.'],
  Groups: ['Groupes', 'Groupes de membres (droits, assignation).'],
  Roles: ['Rôles', 'Rôles et permissions d’instance.'],
  StructureAccess: ['Droits des formulaires', 'Droits par rôle et groupe, filtres de visibilité.'],
  ApiClients: ['Clés API', 'Identifiants des intégrations ; leurs permissions sont leurs scopes.'],
  Settings: ['Paramètres', 'Nom, fuseau, image de marque et menu mobile de l’instance.'],
  Audit: ['Journal d’audit', 'Connexions, administration, droits et exports.'],
  Notifications: ['Notifications', 'Centre de notifications et jetons push de l’appelant.'],
  Sync: ['Synchronisation mobile', 'Protocole hors ligne de l’application mobile.'],
  Health: ['Santé', 'Sonde de disponibilité (hors préfixe `/v1`).'],
  OpenApi: ['Documentation', 'Ce document et sa page interactive.'],
};
const COMPONENT_REF = '#/components/schemas/';

/** Contrôleurs de l'application, dans l'ordre des modules (sans instancier quoi que ce soit). */
export function collectControllers(root: Type): Type[] {
  const seen = new Set<unknown>();
  const controllers: Type[] = [];
  const visit = (entry: unknown) => {
    const module = (entry as { module?: Type } | undefined)?.module ?? entry;
    if (!module || seen.has(module)) return;
    seen.add(module);
    const dynamic =
      entry !== module ? (entry as { controllers?: Type[]; imports?: unknown[] }) : {};
    for (const controller of [
      ...((Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, module) as Type[] | undefined) ?? []),
      ...(dynamic.controllers ?? []),
    ]) {
      if (!controllers.includes(controller)) controllers.push(controller);
    }
    for (const child of [
      ...((Reflect.getMetadata(MODULE_METADATA.IMPORTS, module) as unknown[] | undefined) ?? []),
      ...(dynamic.imports ?? []),
    ]) {
      visit(child);
    }
  };
  visit(root);
  return controllers;
}

/** Les schémas Zod deviennent du JSON Schema ; les sous-schémas nommés rejoignent `components`. */
class SchemaConverter {
  readonly components: Record<string, Json> = {};

  constructor() {
    const { schemas } = z.toJSONSchema(resources, {
      io: 'input',
      unrepresentable: 'any',
      uri: (id) => `${COMPONENT_REF}${id}`,
      override: (ctx) => this.override(ctx),
    }) as { schemas: Record<string, Json> };
    for (const [id, schema] of Object.entries(schemas)) {
      const { $schema: _s, $id: _i, ...rest } = schema;
      this.components[id] = rest;
    }
  }

  convert(schema: z.ZodType, owner: string): Json {
    const ref = resources.get(schema)?.id;
    if (ref) return { $ref: `${COMPONENT_REF}${ref}` };
    const json = z.toJSONSchema(schema, {
      io: 'input',
      unrepresentable: 'any',
      metadata: resources,
      override: (ctx) => this.override(ctx),
    }) as Json;
    const { $schema: _s, $defs, ...rest } = json;
    // Sous-schémas anonymes (récursion locale) : nommés d'après l'opération qui les porte.
    const rename = new Map<string, string>();
    for (const [name, def] of Object.entries(($defs ?? {}) as Record<string, Json>)) {
      const id = this.components[name] ? name : `${owner}_${name}`;
      rename.set(name, id);
      this.components[id] ??= def;
    }
    return relink(rest, rename) as Json;
  }

  private override(ctx: { zodSchema: unknown; jsonSchema: Json }): void {
    const def = (ctx.zodSchema as { _zod: { def: { type: string } } })._zod.def;
    // `z.coerce.date()` : une date ISO 8601 en entrée.
    if (def.type === 'date') Object.assign(ctx.jsonSchema, { type: 'string', format: 'date-time' });
    // Le format suffit (uuid, date-time, email…) : l'expression régulière de Zod est du bruit.
    if (ctx.jsonSchema['format'] && ctx.jsonSchema['pattern']) delete ctx.jsonSchema['pattern'];
    // Bornes implicites des entiers Zod : du bruit dans la documentation.
    if (ctx.jsonSchema['maximum'] === Number.MAX_SAFE_INTEGER) delete ctx.jsonSchema['maximum'];
    if (ctx.jsonSchema['minimum'] === Number.MIN_SAFE_INTEGER) delete ctx.jsonSchema['minimum'];
  }
}

function relink(value: unknown, rename: ReadonlyMap<string, string>): unknown {
  if (Array.isArray(value)) return value.map((item) => relink(item, rename));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      if (key === '$ref' && typeof child === 'string' && child.startsWith('#/$defs/')) {
        const name = child.slice('#/$defs/'.length);
        return [key, `${COMPONENT_REF}${rename.get(name) ?? name}`];
      }
      return [key, relink(child, rename)];
    }),
  );
}

const lowerFirst = (value: string) => value.charAt(0).toLowerCase() + value.slice(1);

/** `:app/lists/:id` → `/v1/{app}/lists/{id}` ; `health` reste hors préfixe. */
function openApiPath(controllerPath: string, methodPath: string): string {
  const joined = [controllerPath, methodPath]
    .map((part) => part.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
  const prefixed = joined === 'health' || joined.startsWith('health/') ? joined : `v1/${joined}`;
  return `/${prefixed}`.replace(/:(\w+)/g, '{$1}');
}

/** Première phrase du commentaire : résumé ; le reste : description. */
function splitComment(comment: string | undefined): { summary?: string; description?: string } {
  if (!comment) return {};
  // Références aux tâches du projet (« (P6.1.1) ») : utiles aux développeurs seulement.
  const text = comment
    .replace(/\s*\(P\d+(\.\d+)*(, P\d+(\.\d+)*)*\)/g, '')
    .replace(/\s*\n\s*/g, ' ')
    .trim();
  let end = text.search(/[.:;](\s|$)/);
  // Phrase longue : le résumé s'arrête à la première incise.
  if (end < 0 || end > 120) end = text.search(/ \(|, /);
  if (end < 0 || end > 120) return text.length <= 120 ? { summary: text } : { description: text };
  const summary = text.slice(0, end).trim();
  const rest = text.slice(end + 1).trim();
  return rest ? { summary, description: text } : { summary };
}

interface RouteArg {
  index: number;
  data?: string;
  pipes?: unknown[];
}

const zodOf = (arg: RouteArg): z.ZodType | undefined =>
  (arg.pipes ?? []).find(
    (pipe): pipe is ZodValidationPipe<z.ZodType> => pipe instanceof ZodValidationPipe,
  )?.schema;

/** Paramètres de requête d'un schéma objet (`page`, `per_page`, filtres…). */
function queryParameters(schema: Json, components: Record<string, Json>): ParameterObject[] {
  const resolved =
    typeof schema['$ref'] === 'string'
      ? components[(schema['$ref'] as string).slice(COMPONENT_REF.length)]!
      : schema;
  const properties = (resolved['properties'] ?? {}) as Record<string, Json>;
  const required = new Set((resolved['required'] ?? []) as string[]);
  return Object.entries(properties).map(([name, property]) => {
    const { description, ...rest } = property;
    return {
      name,
      in: 'query',
      ...(typeof description === 'string' ? { description } : {}),
      ...(required.has(name) && !('default' in property) ? { required: true } : {}),
      schema: rest,
    };
  });
}

const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: `${COMPONENT_REF}Error` } } },
});

export interface BuildOptions {
  version: string;
  docs: DocComments;
}

/** Document OpenAPI 3.1 de l'API, construit depuis les métadonnées des routes (P7.1.2). */
export function buildDocument(controllers: Type[], { version, docs }: BuildOptions): Json {
  const converter = new SchemaConverter();
  const paths: Record<string, Record<string, Json>> = {};
  const tags: Json[] = [];
  const operationIds = new Set<string>();

  for (const controller of controllers) {
    const base = controller.name.replace(/Controller$/, '');
    const section = TAGS[base];
    if (!section) throw new Error(`Section de documentation manquante pour ${controller.name}`);
    const [tag, tagDescription] = section;
    tags.push({ name: tag, description: tagDescription });
    const controllerPaths = [Reflect.getMetadata(PATH_METADATA, controller) as string | string[]]
      .flat()
      .filter((value) => value !== undefined);
    const routeArgs = (method: string) =>
      Object.entries(
        (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, method) ?? {}) as Record<
          string,
          RouteArg
        >,
      )
        .map(([key, arg]) => ({ type: Number(key.split(':')[0]), ...arg }))
        .sort((a, b) => a.index - b.index);

    for (const name of Object.getOwnPropertyNames(controller.prototype)) {
      const handler = (controller.prototype as Record<string, unknown>)[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      const requestMethod = Reflect.getMetadata(METHOD_METADATA, handler) as
        RequestMethod | undefined;
      const httpMethod = requestMethod === undefined ? undefined : HTTP_METHODS[requestMethod];
      if (!httpMethod) continue;

      const options = (Reflect.getMetadata(OPENAPI, handler) ?? {}) as OpenApiOptions;
      const isPublic =
        Reflect.getMetadata(IS_PUBLIC, handler) ?? Reflect.getMetadata(IS_PUBLIC, controller);
      const required = (Reflect.getMetadata(REQUIRED_PERMISSIONS, handler) ??
        Reflect.getMetadata(REQUIRED_PERMISSIONS, controller) ??
        []) as string[];
      const any = (Reflect.getMetadata(ANY_PERMISSIONS, handler) ?? []) as string[];
      const operationId = `${lowerFirst(base)}.${name}`;
      if (operationIds.has(operationId)) throw new Error(`operationId en double : ${operationId}`);
      operationIds.add(operationId);

      const parameters: ParameterObject[] = [];
      let body: Json | undefined;
      let validated = false;
      for (const arg of routeArgs(name)) {
        const schema = zodOf(arg);
        if (schema) validated = true;
        if (arg.type === RouteParamtypes.PARAM && arg.data) {
          const uuid = (arg.pipes ?? []).some(
            (pipe) => pipe === ParseUUIDPipe || pipe instanceof ParseUUIDPipe,
          );
          parameters.push({
            name: arg.data,
            in: 'path',
            required: true,
            schema: uuid ? { type: 'string', format: 'uuid' } : { type: 'string' },
          });
        } else if (arg.type === RouteParamtypes.QUERY && schema) {
          const json = converter.convert(schema, operationId);
          if (arg.data) parameters.push({ name: arg.data, in: 'query', schema: json });
          else parameters.push(...queryParameters(json, converter.components));
        } else if (arg.type === RouteParamtypes.BODY && schema) {
          body = converter.convert(schema, operationId);
        }
      }
      if (options.body) {
        validated = true;
        body = converter.convert(options.body, operationId);
      }

      const path = controllerPaths
        .map((prefix) => openApiPath(prefix, Reflect.getMetadata(PATH_METADATA, handler) as string))
        .at(0)!;
      for (const match of path.matchAll(/\{(\w+)\}/g)) {
        const param = match[1]!;
        if (!parameters.some((p) => p.in === 'path' && p.name === param)) {
          parameters.unshift({
            name: param,
            in: 'path',
            required: true,
            ...(param === 'app'
              ? { description: 'Identifiant court de l’instance (`GET /v1/apps`).' }
              : {}),
            schema: { type: 'string' },
          });
        }
      }
      parameters.push(...(options.parameters ?? []));
      // `fields=` est appliqué globalement à toute réponse JSON (premier niveau).
      if (httpMethod === 'get' && !options.produces) {
        parameters.push({
          name: 'fields',
          in: 'query',
          description: 'Attributs à renvoyer, séparés par des virgules (`id` est toujours inclus).',
          schema: { type: 'string' },
        });
      }
      // Ordre stable : chemin puis requête.
      parameters.sort((a, b) => (a.in === b.in ? 0 : a.in === 'path' ? -1 : 1));

      const status =
        (Reflect.getMetadata(HTTP_CODE_METADATA, handler) as number | undefined) ??
        (httpMethod === 'post' ? HttpStatus.CREATED : HttpStatus.OK);
      const responses: Record<string, Json> = {};
      responses[String(status)] = successResponse(status, options, converter, operationId);
      if (validated) responses['400'] = { $ref: '#/components/responses/ValidationFailed' };
      if (!isPublic) responses['401'] = { $ref: '#/components/responses/Unauthorized' };
      if (required.length || any.length || path.includes('{app}')) {
        responses['403'] = { $ref: '#/components/responses/Forbidden' };
      }
      if (/\{(?!app\})\w+\}/.test(path) || path.includes('{app}')) {
        responses['404'] = { $ref: '#/components/responses/NotFound' };
      }
      responses['429'] = { $ref: '#/components/responses/TooManyRequests' };

      const permissions = [
        ...required.map((p) => `\`${p}\``),
        ...(any.length ? [any.map((p) => `\`${p}\``).join(' ou ')] : []),
      ];
      const { summary, description } = splitComment(docs.get(`${controller.name}.${name}`));
      const permissionNote = permissions.length
        ? `Permission requise : ${permissions.join(', ')}.`
        : undefined;
      const fullDescription = [description, permissionNote].filter(Boolean).join('\n\n');
      const scopes = [...required, ...any];

      const operation: Json = {
        operationId,
        tags: [tag],
        ...(summary ? { summary } : {}),
        ...(fullDescription ? { description: fullDescription } : {}),
        ...(parameters.length ? { parameters } : {}),
        ...(body || options.upload ? { requestBody: requestBody(body, options) } : {}),
        responses,
        ...(isPublic ? { security: [] } : scopes.length ? { security: [{ oauth2: scopes }] } : {}),
      };
      paths[path] ??= {};
      if (paths[path][httpMethod]) throw new Error(`Route en double : ${httpMethod} ${path}`);
      paths[path][httpMethod] = operation;
    }
  }

  const sortedPaths = Object.fromEntries(
    Object.keys(paths)
      .sort()
      .map((path) => [
        path,
        Object.fromEntries(
          METHOD_ORDER.filter((method) => paths[path]![method]).map((method) => [
            method,
            paths[path]![method],
          ]),
        ),
      ]),
  );
  const components = Object.fromEntries(
    Object.keys(converter.components)
      .sort()
      .map((id) => [id, converter.components[id]]),
  );

  return {
    openapi: '3.1.0',
    info: {
      title: 'API Tesserax',
      version,
      description: [
        'API REST de Tesserax : formulaires, fiches, référentiels, tâches, rapports, webhooks.',
        '',
        '- **Authentification** : OAuth2 (`POST /v1/oauth/token`). Les intégrations utilisent ' +
          '`client_credentials` avec une clé API créée dans l’administration ; ses permissions ' +
          'sont les `scope` du jeton.',
        '- **Instance** : toutes les routes métier commencent par `/v1/{app}`, où `app` est le ' +
          'nom court de l’instance.',
        '- **Pagination** : `page` et `per_page` (100 au plus) ; réponse `{ data, meta }`.',
        '- **Attributs** : `fields=a,b` limite les attributs renvoyés.',
        '- **Erreurs** : `{ statusCode, error, message, details? }`, `error` en snake_case.',
        '- **Limitation de débit** : en-têtes `RateLimit-*` ; `429` avec `Retry-After`.',
      ].join('\n'),
    },
    servers: [{ url: '/', description: 'Même origine que la documentation' }],
    tags: Object.values(TAGS).flatMap(([name]) => tags.filter((tag) => tag.name === name)),
    paths: sortedPaths,
    components: {
      schemas: components,
      responses: {
        ValidationFailed: errorResponse(
          'Requête invalide (`validation_failed`, détail par champ).',
        ),
        Unauthorized: errorResponse('Jeton absent, invalide ou expiré.'),
        Forbidden: errorResponse('Permission manquante.'),
        NotFound: errorResponse('Ressource ou instance introuvable (ou inaccessible).'),
        TooManyRequests: {
          ...errorResponse('Trop de requêtes : réessayer après `Retry-After` secondes.'),
          headers: {
            'Retry-After': { schema: { type: 'integer' }, description: 'Délai en secondes.' },
          },
        },
      },
      securitySchemes: {
        oauth2: {
          type: 'oauth2',
          description:
            'Jeton Bearer. Les permissions (scopes) d’un client d’intégration sont fixées par ' +
            'sa clé API ; celles d’un utilisateur, par son rôle dans l’instance.',
          flows: {
            clientCredentials: {
              tokenUrl: '/v1/oauth/token',
              scopes: Object.fromEntries(PERMISSIONS.map((p) => [p, p])),
            },
            password: {
              tokenUrl: '/v1/oauth/token',
              refreshUrl: '/v1/oauth/token',
              scopes: {},
            },
          },
        },
      },
    },
    security: [{ oauth2: [] }],
  };
}

function successResponse(
  status: number,
  options: OpenApiOptions,
  converter: SchemaConverter,
  owner: string,
): Json {
  if (status === HttpStatus.NO_CONTENT) return { description: 'Effectué.' };
  if (options.produces) {
    return {
      description: 'Fichier.',
      content: Object.fromEntries(
        options.produces.map((type) => [type, { schema: { type: 'string', format: 'binary' } }]),
      ),
    };
  }
  let schema: Json = { type: 'object' };
  if (options.response) schema = converter.convert(options.response, owner);
  if (options.list) {
    schema = {
      type: 'object',
      properties: { data: { type: 'array', items: converter.convert(options.list, owner) } },
      required: ['data'],
    };
  }
  if (options.page) {
    schema = {
      type: 'object',
      properties: {
        data: { type: 'array', items: converter.convert(options.page, owner) },
        meta: { $ref: `${COMPONENT_REF}PageMeta` },
      },
      required: ['data', 'meta'],
    };
  }
  return { description: 'Succès.', content: { 'application/json': { schema } } };
}

function requestBody(body: Json | undefined, options: OpenApiOptions): Json {
  if (options.upload) {
    const fields = (body?.['properties'] ?? {}) as Record<string, Json>;
    return {
      required: true,
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            properties: {
              [options.upload]: { type: 'string', format: 'binary' },
              ...fields,
            },
            required: [options.upload],
          },
        },
      },
    };
  }
  const types = options.consumes ?? ['application/json'];
  return {
    required: true,
    content: Object.fromEntries(types.map((type) => [type, { schema: body }])),
  };
}
