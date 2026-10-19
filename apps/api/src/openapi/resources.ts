import * as formSchema from '@tesserax/form-schema';
import { z } from 'zod';

/**
 * Schémas des réponses des ressources publiques (P7.1.2), publiés comme composants nommés de
 * l'OpenAPI. Les tests d'intégration vérifient chaque réponse documentée contre son schéma
 * (`test/helpers.ts`, intercepteur de contrat) : la documentation ne peut pas dériver.
 */
export const resources = z.registry<{ id: string; description?: string }>();

const uuid = z.uuid();
const dateTime = z.iso.datetime({ offset: true });
const nullable = <T extends z.ZodType>(schema: T) => schema.nullable();

// Schémas des formulaires (`@tesserax/form-schema`), nommés pour ne figurer qu'une fois : un
// composant par type de champ (`textField` → `TextField`), plus la définition et le workflow.
for (const [name, schema] of Object.entries(formSchema)) {
  if (name.endsWith('Field') && schema instanceof z.ZodObject) {
    resources.add(schema, { id: name.charAt(0).toUpperCase() + name.slice(1) });
  }
}
resources.add(formSchema.jsonLogicSchema, {
  id: 'JsonLogic',
  description: 'Expression json-logic (ADR 0003).',
});
resources.add(formSchema.conditionSchema, { id: 'Condition' });
resources.add(formSchema.workflowSchema, { id: 'Workflow', description: 'Workflow à états.' });
resources.add(formSchema.structureDefinitionSchema, {
  id: 'StructureDefinition',
  description: 'Définition d’un formulaire : champs, conditions, calculs, workflow.',
});

export const pageMeta = z
  .object({
    page: z.number().int(),
    perPage: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  })
  .register(resources, { id: 'PageMeta', description: 'Pagination `page` / `per_page`.' });

export const apiError = z
  .object({
    statusCode: z.number().int(),
    error: z.string(),
    message: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  })
  .register(resources, {
    id: 'Error',
    description: 'Erreur : code `error` en snake_case, message en français.',
  });

export const app = z
  .object({
    id: uuid,
    short: z.string(),
    name: z.string(),
    timeZone: z.string(),
    locale: z.string(),
  })
  .register(resources, {
    id: 'App',
    description: 'Instance (« app ») : son `short` préfixe toutes les routes `/v1/{app}/…`.',
  });

export const me = z
  .object({
    kind: z.enum(['user', 'client']),
    id: uuid,
    email: z.string().optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    lastLoginAt: nullable(dateTime).optional(),
    permissions: z.array(z.string()).optional(),
  })
  .register(resources, {
    id: 'Me',
    description: 'Appelant : utilisateur ou client d’intégration.',
  });

export const memberProfile = me
  .extend({ roles: z.array(z.string()), permissions: z.array(z.string()) })
  .register(resources, {
    id: 'MemberProfile',
    description: 'Appelant dans une instance, avec ses rôles et permissions.',
  });

const versionStatus = z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']);
const versionSummary = z.object({
  id: uuid,
  version: z.number().int(),
  status: versionStatus,
  publishedAt: nullable(dateTime),
  createdAt: dateTime,
  updatedAt: dateTime,
});

export const structure = z
  .object({
    id: uuid,
    name: z.string(),
    description: nullable(z.string()),
    archivedAt: nullable(dateTime),
    currentVersion: nullable(z.number().int()),
    draftVersion: nullable(z.number().int()),
    createdAt: dateTime,
    updatedAt: dateTime,
    versions: z.array(versionSummary).optional(),
  })
  .register(resources, {
    id: 'Structure',
    description: 'Formulaire, versionné : une version publiée est immuable.',
  });

export const structureVersion = versionSummary
  .extend({ structureId: uuid, definition: formSchema.structureDefinitionSchema })
  .register(resources, { id: 'StructureVersion', description: 'Version d’un formulaire.' });

export const submission = z
  .object({
    id: uuid,
    structureId: uuid,
    structureVersionId: uuid,
    version: z.number().int(),
    state: nullable(z.string()),
    authorId: nullable(uuid),
    revision: z.number().int(),
    data: z.record(z.string(), z.unknown()),
    location: nullable(
      z.object({ lat: z.number(), lng: z.number(), accuracy: nullable(z.number()) }),
    ),
    createdAt: dateTime,
    updatedAt: dateTime,
  })
  .register(resources, {
    id: 'Submission',
    description:
      'Fiche. `data` suit la définition de sa version de structure ; `revision` sert de ' +
      '`baseRevision` aux modifications concurrentes.',
  });

export const stateCount = z
  .object({ state: nullable(z.string()), count: z.number().int() })
  .register(resources, { id: 'StateCount', description: 'Nombre de fiches par état.' });

export const revision = z
  .object({
    id: uuid,
    revision: z.number().int(),
    action: z.enum(['create', 'update', 'transition', 'delete']),
    authorId: nullable(uuid),
    clientMutationId: nullable(z.string()),
    changes: z.array(z.object({ field: z.string(), before: z.unknown(), after: z.unknown() })),
    automation: nullable(z.object({ id: uuid, name: z.string() })),
    createdAt: dateTime,
  })
  .register(resources, { id: 'Revision', description: 'Révision d’une fiche (historique).' });

export const list = z
  .object({
    id: uuid,
    name: z.string(),
    description: nullable(z.string()),
    levels: z.array(z.string()),
    itemCount: z.number().int().optional(),
    createdAt: dateTime,
    updatedAt: dateTime,
  })
  .register(resources, {
    id: 'List',
    description: 'Référentiel, éventuellement hiérarchique (un niveau par libellé de `levels`).',
  });

export const listItem = z
  .object({
    id: uuid,
    listId: uuid,
    parentId: nullable(uuid),
    level: z.number().int(),
    code: nullable(z.string()),
    label: z.string(),
    attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
    position: z.number().int(),
    archivedAt: nullable(dateTime),
  })
  .register(resources, { id: 'ListItem', description: 'Élément d’un référentiel.' });

export const task = z
  .object({
    id: uuid,
    structureId: uuid,
    title: z.string(),
    description: nullable(z.string()),
    assigneeUserId: nullable(uuid),
    assigneeGroupId: nullable(uuid),
    startAt: dateTime,
    endAt: dateTime,
    dueAt: nullable(dateTime),
    locationLabel: nullable(z.string()),
    location: nullable(z.object({ lat: z.number(), lng: z.number() })),
    prefill: z.record(z.string(), z.unknown()),
    status: z.enum(['todo', 'in_progress', 'done', 'cancelled']),
    submissionId: nullable(uuid),
    createdAt: dateTime,
    updatedAt: dateTime,
  })
  .register(resources, {
    id: 'Task',
    description: 'Tâche planifiée : une fiche à saisir, assignée à un membre ou un groupe.',
  });

export const member = z
  .object({
    id: uuid,
    email: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    isActive: z.boolean(),
    role: z.object({ id: uuid, key: z.string(), name: z.string() }),
    attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    groups: z.array(z.object({ id: uuid, name: z.string() })),
    memberSince: dateTime,
    temporaryPassword: z.string().optional(),
  })
  .register(resources, {
    id: 'Member',
    description: 'Membre de l’instance. `temporaryPassword` n’est renvoyé qu’à la création.',
  });

export const file = z
  .object({
    id: uuid,
    name: z.string(),
    mimeType: z.string(),
    size: z.number().int(),
    status: z.enum(['pending', 'uploaded']),
    createdAt: dateTime,
    url: nullable(z.url()),
    thumbnailUrl: nullable(z.url()),
  })
  .register(resources, {
    id: 'File',
    description: 'Fichier ; `url` est une URL signée de courte durée (fichier déposé).',
  });

export const uploadTicket = z
  .object({
    file,
    upload: nullable(
      z.object({
        method: z.literal('PUT'),
        url: z.url(),
        headers: z.record(z.string(), z.string()),
        expiresAt: dateTime,
      }),
    ),
  })
  .register(resources, {
    id: 'UploadTicket',
    description:
      'Dépôt direct : envoyer le contenu en `PUT` sur `upload.url` avec `upload.headers`, ' +
      'puis confirmer par `POST /files/{id}/complete`. `upload` est nul si le fichier est ' +
      'déjà déposé (reprise idempotente avec le même `id`).',
  });

export const reportTemplate = z
  .object({
    id: uuid,
    structureId: uuid,
    name: z.string(),
    fileId: uuid,
    fileName: nullable(z.string()),
    filename: nullable(z.string()),
    tags: z.array(
      z.object({
        name: z.string(),
        kind: z.enum(['value', 'loop', 'image']),
        parent: z.string().optional(),
      }),
    ),
    issues: z.array(z.object({ tag: z.string(), message: z.string() })),
    createdAt: dateTime,
    updatedAt: dateTime,
  })
  .register(resources, { id: 'ReportTemplate', description: 'Modèle de rapport DOCX.' });

export const renderedReport = z
  .object({ url: z.url(), filename: z.string(), cached: z.boolean() })
  .register(resources, {
    id: 'RenderedReport',
    description: 'Rapport PDF d’une fiche : URL signée de courte durée.',
  });

export const webhookEvent = z.enum([
  'submission.created',
  'submission.updated',
  'submission.state_changed',
  'submission.deleted',
]);

export const webhook = z
  .object({
    id: uuid,
    name: z.string(),
    url: z.url(),
    events: z.array(webhookEvent),
    structureId: nullable(uuid),
    enabled: z.boolean(),
    disabledAt: nullable(dateTime),
    disabledReason: nullable(z.string()),
    consecutiveFailures: z.number().int(),
    secretHint: z.string(),
    secret: z.string().optional(),
    createdAt: dateTime,
    updatedAt: dateTime,
  })
  .register(resources, {
    id: 'Webhook',
    description:
      'Webhook sortant signé (HMAC-SHA256, en-tête `X-Tesserax-Signature`). Le secret ' +
      'complet n’est renvoyé qu’à la création et à la rotation.',
  });

export const webhookDelivery = z
  .object({
    id: uuid,
    event: z.string(),
    status: z.enum(['pending', 'delivered', 'failed', 'cancelled']),
    attempts: z.number().int(),
    responseStatus: nullable(z.number().int()),
    error: nullable(z.string()),
    durationMs: nullable(z.number().int()),
    automationRunId: nullable(uuid),
    deliveredAt: nullable(dateTime),
    createdAt: dateTime,
  })
  .register(resources, { id: 'WebhookDelivery', description: 'Livraison d’un webhook.' });

export const tokenResponse = z
  .object({
    access_token: z.string(),
    token_type: z.literal('Bearer'),
    expires_in: z.number().int(),
    refresh_token: z.string().optional(),
    scope: z.string().optional(),
  })
  .register(resources, {
    id: 'TokenResponse',
    description:
      'Jeton OAuth2. `refresh_token` : grants `password` et `refresh_token` uniquement ; ' +
      '`scope` : permissions d’un client d’intégration.',
  });

export const apiClient = z
  .object({
    id: uuid,
    clientId: z.string(),
    name: z.string(),
    scopes: z.array(z.string()),
    revokedAt: nullable(dateTime),
    lastUsedAt: nullable(dateTime),
    createdAt: dateTime,
    updatedAt: dateTime,
  })
  .register(resources, {
    id: 'ApiClient',
    description:
      'Clé API (client OAuth2 `client_credentials`). `scopes` : permissions accordées, ' +
      'qui deviennent les scopes de ses jetons.',
  });

export const apiClientWithSecret = apiClient
  .extend({ clientSecret: z.string() })
  .register(resources, {
    id: 'ApiClientWithSecret',
    description: 'Clé API et son secret, renvoyé uniquement à la création et à la rotation.',
  });

export const temporaryPassword = z.object({ temporaryPassword: z.string() }).register(resources, {
  id: 'TemporaryPassword',
  description: 'Mot de passe provisoire, renvoyé une seule fois, à transmettre au membre.',
});
