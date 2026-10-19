import { type StructureDefinition, type SubmissionData } from '@tesserax/form-schema';
import {
  type MutationPayload,
  type MutationResult,
  type NotificationDto,
  type PullResponse,
  type TaskDto,
  type TaskStatus,
} from '@tesserax/sync';
import {
  type AccessRule,
  type ApiClient,
  type ApiClientWithSecret,
  type AuditEntry,
  type AuditQuery,
  type Dashboard,
  type DashboardInput,
  type PhotoExport,
  type SubmissionAutomationRun,
  type SubmissionMap,
  type TeamPosition,
  type Widget,
  type WidgetData,
  type Automation,
  type AutomationInput,
  type AutomationRun,
  type AutomationRunStatus,
  type EmailMessage,
  type RenderedReport,
  type ReportTags,
  type ReportTemplate,
  type Webhook,
  type WebhookDelivery,
  type WebhookEvent,
  type WebhookInput,
  type FileDto,
  type Filter,
  type Group,
  type ImportReport,
  type InstanceSummary,
  type LevelMapping,
  type List,
  type ListItem,
  type Me,
  type Member,
  type MemberProfile,
  type Page,
  type Revision,
  type Role,
  type Settings,
  type StateCount,
  type Structure,
  type StructureVersion,
  type Submission,
  type SubmissionConflict,
  type Tokens,
} from './types.js';

/** Erreur de l'API : `{ statusCode, error, message, details? }` ou erreur OAuth2. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** URL signée de dépôt direct d'un fichier dans le stockage. */
export interface UploadTicket {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
}

/** Persistance des jetons, propre à chaque plateforme (localStorage, SecureStore…). */
export interface TokenStore {
  get(): Tokens | null;
  set(tokens: Tokens | null): void;
}

export interface ClientOptions {
  /** Racine de l'API, sans `/v1` (ex. `''` derrière un proxy, `https://api.exemple.ci`). */
  baseUrl: string;
  tokens: TokenStore;
  /** Session perdue (refresh refusé) : l'interface renvoie vers la connexion. */
  onSessionExpired?: () => void;
  fetch?: typeof fetch;
}

export type Query = Record<string, string | number | boolean | undefined | null>;

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  form?: FormData | URLSearchParams;
  /** Ne pas tenter de renouveler la session sur 401. */
  anonymous?: boolean;
  raw?: boolean;
}

export interface ListParams {
  page?: number;
  perPage?: number;
}

export interface TaskQuery extends ListParams {
  /** Période (ISO 8601) : tâches qui la chevauchent. */
  from?: string;
  to?: string;
  structureId?: string;
  assigneeUserId?: string;
  assigneeGroupId?: string;
  status?: TaskStatus;
  /** Seulement les tâches assignées à l'appelant. */
  mine?: boolean;
}

/** Champs modifiables d'une tâche (dates ISO 8601). */
export interface TaskInput {
  title: string;
  description?: string | null;
  assigneeUserId?: string | null;
  assigneeGroupId?: string | null;
  startAt: string;
  endAt: string;
  dueAt?: string | null;
  locationLabel?: string | null;
  location?: { lat: number; lng: number } | null;
  prefill?: SubmissionData;
  status?: TaskStatus;
}

export interface SubmissionQuery extends ListParams {
  sort?: string;
  state?: string;
  authorId?: string;
  /** Période de création (ISO 8601), bornes incluse / exclue. */
  createdFrom?: string;
  createdTo?: string;
  filters?: Filter[];
}

function toQuery(params: ListParams = {}): Query {
  return { page: params.page, per_page: params.perPage };
}

function submissionQuery({ filters = [], authorId, ...rest }: SubmissionQuery = {}): Query {
  const query: Query = {
    ...toQuery(rest),
    sort: rest.sort,
    state: rest.state,
    author_id: authorId,
    created_from: rest.createdFrom,
    created_to: rest.createdTo,
  };
  for (const filter of filters) {
    query[
      filter.operator === 'eq'
        ? `filter[${filter.key}]`
        : `filter[${filter.key}][${filter.operator}]`
    ] = filter.value;
  }
  return query;
}

export function createClient(options: ClientOptions) {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  // Un seul renouvellement à la fois : deux refresh simultanés révoqueraient la session (ADR 0002).
  let refreshing: Promise<boolean> | undefined;

  const url = (path: string, query?: Query) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
    }
    const qs = search.toString();
    return `${options.baseUrl}/v1${path}${qs ? `?${qs}` : ''}`;
  };

  async function parseError(response: Response): Promise<ApiError> {
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const code = String(body['error'] ?? 'error');
    const message = String(body['message'] ?? body['error_description'] ?? response.statusText);
    return new ApiError(response.status, code, message, body['details']);
  }

  async function refresh(): Promise<boolean> {
    refreshing ??= (async () => {
      const refreshToken = options.tokens.get()?.refresh_token;
      if (!refreshToken) return false;
      const response = await doFetch(url('/oauth/token'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshToken }),
      });
      if (!response.ok) return false;
      options.tokens.set((await response.json()) as Tokens);
      return true;
    })().finally(() => {
      refreshing = undefined;
    });
    return refreshing;
  }

  async function request<T>(method: string, path: string, init: RequestOptions = {}): Promise<T> {
    const send = () => {
      const headers: Record<string, string> = {};
      const token = options.tokens.get()?.access_token;
      if (token && !init.anonymous) headers['Authorization'] = `Bearer ${token}`;
      let body: BodyInit | undefined;
      if (init.form) body = init.form;
      else if (init.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(init.body);
      }
      return doFetch(url(path, init.query), { method, headers, body });
    };

    let response = await send();
    if (response.status === 401 && !init.anonymous) {
      if (await refresh()) response = await send();
      if (response.status === 401) {
        options.tokens.set(null);
        options.onSessionExpired?.();
      }
    }
    if (!response.ok) throw await parseError(response);
    if (init.raw) return (await response.blob()) as T;
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  const get = <T>(path: string, query?: Query) => request<T>('GET', path, { query });
  const post = <T>(path: string, body?: unknown) => request<T>('POST', path, { body });
  const patch = <T>(path: string, body: unknown) => request<T>('PATCH', path, { body });
  const put = <T>(path: string, body: unknown) => request<T>('PUT', path, { body });
  const del = (path: string, query?: Query) => request<void>('DELETE', path, { query });

  /** Ressources d'une instance (`/v1/{app}/…`). */
  function app(short: string) {
    const p = (path: string) => `/${encodeURIComponent(short)}${path}`;
    return {
      me: () => get<MemberProfile>(p('/me')),
      settings: {
        get: () => get<Settings>(p('/settings')),
        update: (body: Partial<Omit<Settings, 'id' | 'short'>>) =>
          patch<Settings>(p('/settings'), body),
      },
      structures: {
        /** JSON Schema de la définition d'un formulaire (outillage, validation externe). */
        schema: () => get<Record<string, unknown>>(p('/structures/schema')),
        list: (params: ListParams & { includeArchived?: boolean } = {}) =>
          get<Page<Structure>>(p('/structures'), {
            ...toQuery(params),
            include_archived: params.includeArchived,
          }),
        get: (id: string) => get<Structure>(p(`/structures/${id}`)),
        create: (body: { name: string; description?: string; definition?: StructureDefinition }) =>
          post<Structure>(p('/structures'), body),
        update: (id: string, body: { name?: string; description?: string | null }) =>
          patch<Structure>(p(`/structures/${id}`), body),
        archive: (id: string) => del(p(`/structures/${id}`)),
        version: (id: string, ref: number | 'draft' | 'current') =>
          get<StructureVersion>(p(`/structures/${id}/versions/${ref}`)),
        saveDraft: (id: string, definition: StructureDefinition) =>
          put<StructureVersion>(p(`/structures/${id}/draft`), { definition }),
        publish: (id: string) => post<StructureVersion>(p(`/structures/${id}/publish`)),
        access: (id: string) => get<{ data: AccessRule[] }>(p(`/structures/${id}/access`)),
        setAccess: (id: string, rules: AccessRule[]) =>
          put<{ data: AccessRule[] }>(p(`/structures/${id}/access`), { rules }),
      },
      submissions: {
        list: (structureId: string, query?: SubmissionQuery) =>
          get<Page<Submission>>(
            p(`/structures/${structureId}/submissions`),
            submissionQuery(query),
          ),
        export: (structureId: string, format: 'csv' | 'xlsx', query?: SubmissionQuery) =>
          request<Blob>('GET', p(`/structures/${structureId}/submissions/export`), {
            query: { ...submissionQuery(query), format },
            raw: true,
          }),
        get: (id: string) => get<Submission>(p(`/submissions/${id}`)),
        create: (
          structureId: string,
          body: { id?: string; data: SubmissionData; clientMutationId?: string },
        ) => post<Submission>(p(`/structures/${structureId}/submissions`), body),
        update: (
          id: string,
          body: { data: SubmissionData; clientMutationId?: string; baseRevision?: number },
        ) => patch<Submission>(p(`/submissions/${id}`), body),
        /** Compteurs par état, avec les filtres de la liste (hors état). */
        states: (structureId: string, query?: SubmissionQuery) =>
          get<{ data: StateCount[] }>(
            p(`/structures/${structureId}/submissions/states`),
            submissionQuery(query),
          ),
        transition: (
          id: string,
          body: {
            transition: string;
            data?: SubmissionData;
            clientMutationId?: string;
            baseRevision?: number;
          },
        ) => post<Submission>(p(`/submissions/${id}/transition`), body),
        conflicts: (id: string) =>
          get<{ data: SubmissionConflict[] }>(p(`/submissions/${id}/conflicts`)),
        resolveConflict: (id: string, conflictId: string, resolution: 'kept' | 'restored') =>
          post<SubmissionConflict>(p(`/submissions/${id}/conflicts/${conflictId}/resolve`), {
            resolution,
          }),
        remove: (id: string) => del(p(`/submissions/${id}`)),
        revisions: (id: string, params?: ListParams) =>
          get<Page<Revision>>(p(`/submissions/${id}/revisions`), toQuery(params)),
        /** Automatisations exécutées sur la fiche (historique). */
        automationRuns: (id: string) =>
          get<{ data: SubmissionAutomationRun[] }>(p(`/submissions/${id}/automation-runs`)),
        /** Fiches localisées en GeoJSON, avec les filtres de la liste (pagination ignorée). */
        map: (structureId: string, query?: SubmissionQuery) =>
          get<SubmissionMap>(
            p(`/structures/${structureId}/submissions/map`),
            submissionQuery(query),
          ),
      },
      team: {
        /** Dernière position connue de chaque membre. */
        positions: () => get<{ data: TeamPosition[] }>(p('/team/positions')),
      },
      dashboards: {
        list: () => get<{ data: Dashboard[] }>(p('/dashboards')),
        get: (id: string) => get<Dashboard>(p(`/dashboards/${id}`)),
        create: (body: DashboardInput) => post<Dashboard>(p('/dashboards'), body),
        update: (id: string, body: DashboardInput) => put<Dashboard>(p(`/dashboards/${id}`), body),
        remove: (id: string) => del(p(`/dashboards/${id}`)),
        /** Valeurs d'un widget, enregistré ou en cours d'édition. */
        widgetData: (widget: Widget) => post<WidgetData>(p('/dashboards/widget-data'), widget),
      },
      audit: {
        list: ({ page, perPage, actorId, targetId, ...rest }: AuditQuery = {}) =>
          get<Page<AuditEntry>>(p('/audit-logs'), {
            ...toQuery({ page, perPage }),
            ...rest,
            actor_id: actorId,
            target_id: targetId,
          }),
        actions: () => get<{ data: string[] }>(p('/audit-logs/actions')),
      },
      photoExports: {
        /** Lance l'export ZIP des photos des fiches sélectionnées (mêmes filtres que la liste). */
        create: (
          structureId: string,
          body: Omit<SubmissionQuery, 'page' | 'perPage'> & { pattern?: string },
        ) => {
          const { filters = [], authorId, createdFrom, createdTo, ...rest } = body;
          return post<PhotoExport & { missing: number }>(
            p(`/structures/${structureId}/photo-exports`),
            {
              ...rest,
              filters,
              author_id: authorId,
              created_from: createdFrom,
              created_to: createdTo,
            },
          );
        },
        list: (params?: ListParams) => get<Page<PhotoExport>>(p('/photo-exports'), toQuery(params)),
        get: (id: string) => get<PhotoExport>(p(`/photo-exports/${id}`)),
        /** URL signée de courte durée vers l'archive. */
        download: (id: string) =>
          post<{ id: string; url: string; expiresIn: number }>(p(`/photo-exports/${id}/download`)),
      },
      tasks: {
        list: (query: TaskQuery = {}) =>
          get<Page<TaskDto>>(p('/tasks'), {
            ...toQuery({ page: query.page, perPage: query.perPage }),
            from: query.from,
            to: query.to,
            structure_id: query.structureId,
            assignee_user_id: query.assigneeUserId,
            assignee_group_id: query.assigneeGroupId,
            status: query.status,
            mine: query.mine,
          }),
        get: (id: string) => get<TaskDto>(p(`/tasks/${id}`)),
        create: (body: TaskInput & { id?: string; structureId: string }) =>
          post<TaskDto>(p('/tasks'), body),
        update: (id: string, body: Partial<TaskInput>) => patch<TaskDto>(p(`/tasks/${id}`), body),
        remove: (id: string) => del(p(`/tasks/${id}`)),
      },
      reports: {
        list: (structureId: string) =>
          get<{ data: ReportTemplate[] }>(p(`/structures/${structureId}/reports`)),
        get: (id: string) => get<ReportTemplate>(p(`/reports/${id}`)),
        tags: (structureId: string) =>
          get<ReportTags>(p(`/structures/${structureId}/reports/tags`)),
        create: (
          structureId: string,
          body: { name: string; fileId: string; filename?: string | null },
        ) => post<ReportTemplate>(p(`/structures/${structureId}/reports`), body),
        update: (id: string, body: { name?: string; fileId?: string; filename?: string | null }) =>
          patch<ReportTemplate>(p(`/reports/${id}`), body),
        remove: (id: string) => del(p(`/reports/${id}`)),
        /** URL signée du modèle DOCX. */
        template: (id: string) => get<{ url: string }>(p(`/reports/${id}/template`)),
        /** PDF d'une fiche, ou aperçu sur une fiche d'exemple sans `submissionId`. */
        render: (id: string, submissionId?: string) =>
          post<RenderedReport>(p(`/reports/${id}/render`), submissionId ? { submissionId } : {}),
      },
      automations: {
        list: (structureId?: string) =>
          get<{ data: Automation[] }>(p('/automations'), { structure_id: structureId }),
        get: (id: string) => get<Automation>(p(`/automations/${id}`)),
        create: (body: AutomationInput) => post<Automation>(p('/automations'), body),
        update: (id: string, body: AutomationInput) =>
          put<Automation>(p(`/automations/${id}`), body),
        remove: (id: string) => del(p(`/automations/${id}`)),
        runs: (
          query: ListParams & {
            automationId?: string;
            submissionId?: string;
            status?: AutomationRunStatus;
          } = {},
        ) =>
          get<Page<AutomationRun>>(p('/automation-runs'), {
            ...toQuery(query),
            automation_id: query.automationId,
            submission_id: query.submissionId,
            status: query.status,
          }),
        retry: (runId: string) => post<AutomationRun>(p(`/automation-runs/${runId}/retry`), {}),
      },
      emails: {
        list: (query: ListParams & { status?: EmailMessage['status'] } = {}) =>
          get<Page<EmailMessage>>(p('/emails'), { ...toQuery(query), status: query.status }),
        retry: (id: string) => post<{ id: string; status: string }>(p(`/emails/${id}/retry`), {}),
      },
      apiClients: {
        list: () => get<{ data: ApiClient[] }>(p('/api-clients')),
        get: (id: string) => get<ApiClient>(p(`/api-clients/${id}`)),
        create: (body: { name: string; scopes: string[] }) =>
          post<ApiClientWithSecret>(p('/api-clients'), body),
        update: (id: string, body: { name?: string; scopes?: string[] }) =>
          patch<ApiClient>(p(`/api-clients/${id}`), body),
        rotateSecret: (id: string) => post<ApiClientWithSecret>(p(`/api-clients/${id}/secret`)),
        revoke: (id: string) => del(p(`/api-clients/${id}`)),
      },
      webhooks: {
        list: () => get<{ data: Webhook[] }>(p('/webhooks')),
        get: (id: string) => get<Webhook>(p(`/webhooks/${id}`)),
        events: () => get<{ data: WebhookEvent[] }>(p('/webhooks/events')),
        create: (body: WebhookInput) => post<Webhook & { secret: string }>(p('/webhooks'), body),
        update: (id: string, body: Partial<WebhookInput> & { enabled?: boolean }) =>
          patch<Webhook>(p(`/webhooks/${id}`), body),
        remove: (id: string) => del(p(`/webhooks/${id}`)),
        rotateSecret: (id: string) =>
          post<Webhook & { secret: string }>(p(`/webhooks/${id}/secret`), {}),
        ping: (id: string) => post<{ deliveryId: string }>(p(`/webhooks/${id}/ping`), {}),
        deliveries: (id: string, params?: ListParams) =>
          get<Page<WebhookDelivery>>(p(`/webhooks/${id}/deliveries`), toQuery(params)),
        redeliver: (id: string, deliveryId: string) =>
          post<{ deliveryId: string }>(p(`/webhooks/${id}/deliveries/${deliveryId}/retry`), {}),
      },
      notifications: {
        list: (params: ListParams & { unread?: boolean } = {}) =>
          get<Page<NotificationDto> & { meta: { unread: number } }>(p('/notifications'), {
            ...toQuery(params),
            unread: params.unread,
          }),
        /** Marque comme lues les notifications données (toutes sans liste). */
        read: (ids?: string[]) => post<{ updated: number }>(p('/notifications/read'), { ids }),
        registerPushToken: (token: string, platform?: 'ios' | 'android' | 'web') =>
          post<void>(p('/push-tokens'), { token, platform }),
        unregisterPushToken: (token: string) => del(p('/push-tokens'), { token }),
      },
      lists: {
        list: (params?: ListParams) => get<Page<List>>(p('/lists'), toQuery(params)),
        get: (id: string) => get<List>(p(`/lists/${id}`)),
        create: (body: { name: string; description?: string; levels: string[] }) =>
          post<List>(p('/lists'), body),
        update: (
          id: string,
          body: { name?: string; description?: string | null; levels?: string[] },
        ) => patch<List>(p(`/lists/${id}`), body),
        remove: (id: string) => del(p(`/lists/${id}`)),
        items: (
          id: string,
          params: ListParams & {
            parentId?: string | 'root';
            level?: number;
            q?: string;
            code?: string;
          } = {},
        ) =>
          get<Page<ListItem>>(p(`/lists/${id}/items`), {
            ...toQuery({ page: params.page, perPage: params.perPage }),
            parent_id: params.parentId,
            level: params.level,
            q: params.q,
            code: params.code,
          }),
        createItem: (
          id: string,
          body: {
            label: string;
            code?: string;
            parentId?: string;
            attributes?: ListItem['attributes'];
          },
        ) => post<ListItem>(p(`/lists/${id}/items`), body),
        updateItem: (
          id: string,
          itemId: string,
          body: { label?: string; code?: string | null; attributes?: ListItem['attributes'] },
        ) => patch<ListItem>(p(`/lists/${id}/items/${itemId}`), body),
        archiveItem: (id: string, itemId: string) => del(p(`/lists/${id}/items/${itemId}`)),
        lookup: (code: string) =>
          get<{ data: (ListItem & { list: List })[] }>(p('/list-items'), { code }),
        byIds: (ids: string[]) =>
          get<{ data: (ListItem & { list: List })[] }>(p('/list-items'), { ids: ids.join(',') }),
        import: (
          id: string,
          file: Blob,
          options: { mode: 'merge' | 'replace'; dryRun: boolean; mapping?: LevelMapping[] },
        ) => {
          const form = new FormData();
          form.set('file', file);
          form.set('mode', options.mode);
          form.set('dry_run', String(options.dryRun));
          if (options.mapping) form.set('mapping', JSON.stringify(options.mapping));
          return request<ImportReport>('POST', p(`/lists/${id}/import`), { form });
        },
        export: (id: string, format: 'csv' | 'xlsx') =>
          request<Blob>('GET', p(`/lists/${id}/export`), { query: { format }, raw: true }),
      },
      users: {
        list: (params?: ListParams) => get<Page<Member>>(p('/users'), toQuery(params)),
        get: (id: string) => get<Member>(p(`/users/${id}`)),
        invite: (body: {
          email: string;
          firstName: string;
          lastName: string;
          roleId: string;
          password?: string;
          attributes?: Member['attributes'];
        }) => post<Member>(p('/users'), body),
        update: (id: string, body: { roleId?: string; attributes?: Member['attributes'] }) =>
          patch<Member>(p(`/users/${id}`), body),
        remove: (id: string) => del(p(`/users/${id}`)),
      },
      roles: {
        list: (params?: ListParams) => get<Page<Role>>(p('/roles'), toQuery(params)),
        permissions: () => get<{ data: string[] }>(p('/roles/permissions')),
        create: (body: { key: string; name: string; permissions: string[] }) =>
          post<Role>(p('/roles'), body),
        update: (id: string, body: { name?: string; permissions?: string[] }) =>
          patch<Role>(p(`/roles/${id}`), body),
        remove: (id: string) => del(p(`/roles/${id}`)),
      },
      groups: {
        list: (params?: ListParams) => get<Page<Group>>(p('/groups'), toQuery(params)),
        get: (id: string) => get<Group>(p(`/groups/${id}`)),
        create: (name: string) => post<Group>(p('/groups'), { name }),
        rename: (id: string, name: string) => patch<Group>(p(`/groups/${id}`), { name }),
        remove: (id: string) => del(p(`/groups/${id}`)),
        setMembers: (id: string, userIds: string[]) =>
          put<{ data: NonNullable<Group['members']> }>(p(`/groups/${id}/members`), { userIds }),
      },
      sync: {
        pull: (cursor?: string) => get<PullResponse>(p('/sync/pull'), { cursor }),
        push: (mutations: MutationPayload[]) =>
          post<{ results: MutationResult[] }>(p('/sync/push'), { mutations }),
      },
      files: {
        get: (id: string) => get<FileDto>(p(`/files/${id}`)),
        /** Demande d'URL signée ; `upload` est null si le fichier est déjà déposé. */
        requestUpload: (meta: { id?: string; name: string; mimeType: string; size: number }) =>
          post<{ file: FileDto; upload: UploadTicket | null }>(p('/files/upload'), meta),
        complete: (id: string) => post<FileDto>(p(`/files/${id}/complete`)),
        /** Dépôt complet : demande d'URL signée, envoi direct au stockage, confirmation. */
        upload: async (file: Blob & { name?: string }, id?: string): Promise<FileDto> => {
          const { file: meta, upload } = await post<{ file: FileDto; upload: UploadTicket | null }>(
            p('/files/upload'),
            {
              id,
              name: file.name ?? 'fichier',
              mimeType: file.type || 'application/octet-stream',
              size: file.size,
            },
          );
          if (!upload) return meta;
          const sent = await doFetch(upload.url, {
            method: upload.method,
            headers: upload.headers,
            body: file,
          });
          if (!sent.ok)
            throw new ApiError(sent.status, 'upload_failed', 'Échec du dépôt du fichier');
          return post<FileDto>(p(`/files/${meta.id}/complete`));
        },
      },
    };
  }

  return {
    request,
    async login(email: string, password: string): Promise<void> {
      const tokens = await request<Tokens>('POST', '/oauth/token', {
        anonymous: true,
        body: { grant_type: 'password', username: email, password },
      });
      options.tokens.set(tokens);
    },
    async logout(): Promise<void> {
      const refreshToken = options.tokens.get()?.refresh_token;
      options.tokens.set(null);
      if (refreshToken) {
        await request('POST', '/oauth/revoke', {
          anonymous: true,
          body: { token: refreshToken },
        }).catch(() => undefined);
      }
    },
    isAuthenticated: () => options.tokens.get() !== null,
    me: () => get<Me>('/me'),
    apps: () => get<{ data: InstanceSummary[] }>('/apps'),
    app,
  };
}

export type TesseraxClient = ReturnType<typeof createClient>;
export type AppClient = ReturnType<TesseraxClient['app']>;
