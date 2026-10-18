import { type StructureDefinition, type SubmissionData } from '@tesserax/form-schema';
import { type MutationPayload, type MutationResult, type PullResponse } from '@tesserax/sync';
import {
  type AccessRule,
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

export interface SubmissionQuery extends ListParams {
  sort?: string;
  state?: string;
  authorId?: string;
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
        conflicts: (id: string) =>
          get<{ data: SubmissionConflict[] }>(p(`/submissions/${id}/conflicts`)),
        resolveConflict: (id: string, conflictId: string, resolution: 'kept' | 'restored') =>
          post<SubmissionConflict>(p(`/submissions/${id}/conflicts/${conflictId}/resolve`), {
            resolution,
          }),
        remove: (id: string) => del(p(`/submissions/${id}`)),
        revisions: (id: string, params?: ListParams) =>
          get<Page<Revision>>(p(`/submissions/${id}/revisions`), toQuery(params)),
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
