import { createClient } from '@tesserax/sdk';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OPENAPI_FILE } from './openapi-file';

const document = JSON.parse(readFileSync(OPENAPI_FILE, 'utf8')) as {
  paths: Record<string, Record<string, { operationId: string }>>;
};
const operations = Object.entries(document.paths).flatMap(([path, methods]) =>
  Object.entries(methods).map(([method, { operationId }]) => ({
    operationId,
    method: method.toUpperCase(),
    pattern: new RegExp(`^${path.replace(/\{\w+\}/g, '[^/]+')}$`),
  })),
);

const ID = '00000000-0000-4000-8000-000000000001';

/** Appelle chaque méthode du SDK (arguments factices) et relève les requêtes émises. */
async function sdkCalls() {
  const calls: { sdk: string; method: string; path: string }[] = [];
  let current = '';
  const client = createClient({
    baseUrl: 'http://api',
    tokens: {
      get: () => ({ access_token: 'a', refresh_token: 'r', token_type: 'Bearer', expires_in: 900 }),
      set() {},
    },
    fetch: (async (url: string, init?: RequestInit) => {
      calls.push({ sdk: current, method: init?.method ?? 'GET', path: new URL(url).pathname });
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch,
  });
  const visit = async (node: Record<string, unknown>, prefix: string) => {
    for (const [name, value] of Object.entries(node)) {
      if (name === 'request' || name === 'isAuthenticated') continue;
      const key = prefix ? `${prefix}.${name}` : name;
      if (typeof value === 'function') {
        if (name === 'app') {
          await visit((value as (short: string) => Record<string, unknown>)('demo'), 'app');
          continue;
        }
        current = key;
        // Arguments factices : une méthode qui les refuse avant d'appeler l'API ne compte pas.
        await (async () => (value as (...args: unknown[]) => unknown)(ID, ID, ID))().catch(
          () => undefined,
        );
      } else if (value && typeof value === 'object') {
        await visit(value as Record<string, unknown>, key);
      }
    }
  };
  await visit(client as unknown as Record<string, unknown>, '');
  return calls;
}

describe('SDK et OpenAPI (P7.1.3)', () => {
  it('chaque méthode du SDK appelle une opération documentée', async () => {
    const calls = await sdkCalls();
    expect(calls.length).toBeGreaterThan(90);
    const unknown = calls.filter(
      (call) => !operations.some((op) => op.method === call.method && op.pattern.test(call.path)),
    );
    expect(unknown).toEqual([]);
  });

  it('chaque opération est couverte par le SDK, sauf la documentation et l’exploitation', async () => {
    const calls = await sdkCalls();
    const uncovered = operations
      .filter(
        (op) => !calls.some((call) => op.method === call.method && op.pattern.test(call.path)),
      )
      .map((op) => op.operationId);
    expect(uncovered.sort()).toEqual([
      'health.check',
      'health.live',
      'metrics.read',
      'openApi.docs',
      'openApi.init',
      'openApi.openapi',
    ]);
  });
});
