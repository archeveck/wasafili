import { describe, expect, it, vi } from 'vitest';
import { ApiError, createClient, type TokenStore } from './client.js';
import { type Tokens } from './types.js';

function memoryStore(initial: Tokens | null = null): TokenStore & { value: Tokens | null } {
  return {
    value: initial,
    get() {
      return this.value;
    },
    set(tokens) {
      this.value = tokens;
    },
  };
}

const json = (status: number, body: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const tokens = (access: string, refresh = `r-${access}`): Tokens => ({
  access_token: access,
  refresh_token: refresh,
  token_type: 'Bearer',
  expires_in: 900,
});

describe('client', () => {
  it('se connecte puis envoie le jeton', async () => {
    const store = memoryStore();
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/oauth/token')) return json(200, tokens('a1'));
      expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer a1');
      return json(200, { kind: 'user', id: 'u1' });
    });
    const client = createClient({ baseUrl: 'http://api', tokens: store, fetch: fetch as never });
    await client.login('a@b.ci', 'x');
    expect(client.isAuthenticated()).toBe(true);
    expect(await client.me()).toEqual({ kind: 'user', id: 'u1' });
    expect(fetch.mock.calls[1]![0]).toBe('http://api/v1/me');
  });

  it('renouvelle la session une seule fois pour des requêtes concurrentes', async () => {
    const store = memoryStore(tokens('expire'));
    let refreshes = 0;
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/oauth/token')) {
        refreshes++;
        return json(200, tokens('neuf'));
      }
      const auth = (init?.headers as Record<string, string>)['Authorization'];
      return auth === 'Bearer neuf'
        ? json(200, { data: [] })
        : json(401, { error: 'invalid_token' });
    });
    const client = createClient({ baseUrl: '', tokens: store, fetch: fetch as never });
    await Promise.all([client.apps(), client.apps(), client.apps()]);
    expect(refreshes).toBe(1);
    expect(store.value?.access_token).toBe('neuf');
  });

  it('signale la fin de session quand le renouvellement échoue', async () => {
    const store = memoryStore(tokens('expire'));
    const onSessionExpired = vi.fn();
    const fetch = vi.fn(async (url: string) =>
      url.endsWith('/oauth/token')
        ? json(400, { error: 'invalid_grant' })
        : json(401, { error: 'invalid_token' }),
    );
    const client = createClient({
      baseUrl: '',
      tokens: store,
      fetch: fetch as never,
      onSessionExpired,
    });
    await expect(client.me()).rejects.toMatchObject({ status: 401 });
    expect(onSessionExpired).toHaveBeenCalled();
    expect(store.value).toBeNull();
  });

  it('transforme les erreurs en ApiError avec code et détails', async () => {
    const fetch = vi.fn(async () =>
      json(422, {
        statusCode: 422,
        error: 'invalid_data',
        message: 'Données invalides',
        details: [{ code: 'required' }],
      }),
    );
    const client = createClient({
      baseUrl: '',
      tokens: memoryStore(tokens('a')),
      fetch: fetch as never,
    });
    const error = await client
      .app('demo')
      .submissions.create('s', { data: {} })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 422,
      code: 'invalid_data',
      details: [{ code: 'required' }],
    });
  });

  it('construit filtres, tri et pagination', async () => {
    const fetch = vi.fn(async (_url: string) => json(200, { data: [], meta: {} }));
    const client = createClient({
      baseUrl: '',
      tokens: memoryStore(tokens('a')),
      fetch: fetch as never,
    });
    await client.app('demo').submissions.list('s1', {
      page: 2,
      perPage: 10,
      sort: '-date',
      filters: [
        { key: 'etat', operator: 'eq', value: 'bon' },
        { key: 'cout', operator: 'gte', value: '5' },
      ],
    });
    const url = new URL(fetch.mock.calls[0]![0], 'http://x');
    expect(url.pathname).toBe('/v1/demo/structures/s1/submissions');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      page: '2',
      per_page: '10',
      sort: '-date',
      'filter[etat]': 'bon',
      'filter[cout][gte]': '5',
    });
  });

  it('dépose un fichier : URL signée, envoi direct, confirmation', async () => {
    const calls: string[] = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method} ${url}`);
      if (url.endsWith('/files/upload')) {
        return json(201, {
          file: { id: 'f1', status: 'pending' },
          upload: { url: 'http://s3/put', method: 'PUT', headers: { 'Content-Type': 'image/png' } },
        });
      }
      if (url === 'http://s3/put') return new Response(null, { status: 200 });
      return json(200, { id: 'f1', status: 'uploaded' });
    });
    const client = createClient({
      baseUrl: '',
      tokens: memoryStore(tokens('a')),
      fetch: fetch as never,
    });
    const blob = new Blob(['png'], { type: 'image/png' });
    expect(await client.app('demo').files.upload(blob)).toEqual({ id: 'f1', status: 'uploaded' });
    expect(calls).toEqual([
      'POST /v1/demo/files/upload',
      'PUT http://s3/put',
      'POST /v1/demo/files/f1/complete',
    ]);
  });

  it('révoque la session à la déconnexion', async () => {
    const store = memoryStore(tokens('a', 'r1'));
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => json(200, {}));
    const client = createClient({ baseUrl: '', tokens: store, fetch: fetch as never });
    await client.logout();
    expect(store.value).toBeNull();
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toEqual({ token: 'r1' });
  });

  it('carte, audit et export de photos : paramètres au format de l API', async () => {
    const calls: { url: string; body?: unknown }[] = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, ...(init?.body ? { body: JSON.parse(init.body as string) } : {}) });
      return json(200, {});
    });
    const app = createClient({
      baseUrl: 'http://api',
      tokens: memoryStore(tokens('a')),
      fetch: fetch as never,
    }).app('acme');
    const filters = [{ key: 'categorie', operator: 'eq' as const, value: 'pompe' }];
    await app.submissions.map('s1', { filters, state: 'valide' });
    await app.audit.list({ action: 'role.', actorId: 'u1', perPage: 50 });
    await app.photoExports.create('s1', { filters, authorId: 'u2', pattern: '{n}' });
    expect(decodeURI(calls[0]!.url)).toBe(
      'http://api/v1/acme/structures/s1/submissions/map?state=valide&filter[categorie]=pompe',
    );
    expect(calls[1]!.url).toBe(
      'http://api/v1/acme/audit-logs?per_page=50&action=role.&actor_id=u1',
    );
    expect(calls[2]).toEqual({
      url: 'http://api/v1/acme/structures/s1/photo-exports',
      body: { pattern: '{n}', filters, author_id: 'u2' },
    });
  });
});
