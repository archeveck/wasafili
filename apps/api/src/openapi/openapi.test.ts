import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OPENAPI_FILE, generateOpenApi } from './generate';

type Operation = {
  operationId: string;
  summary?: string;
  security?: { oauth2: string[] }[];
  responses: Record<string, unknown>;
};

describe('OpenAPI', () => {
  const generated = generateOpenApi();
  const document = JSON.parse(generated) as {
    paths: Record<string, Record<string, Operation>>;
    components: { schemas: Record<string, unknown> };
  };
  const operations = Object.entries(document.paths).flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, operation]) => ({ path, method, ...operation })),
  );

  it('le document versionné est à jour (`pnpm --filter @tesserax/api openapi`)', () => {
    expect(readFileSync(OPENAPI_FILE, 'utf8') === generated).toBe(true);
  });

  it('chaque opération est résumée et a un identifiant unique', () => {
    expect(operations.filter((op) => !op.summary).map((op) => op.operationId)).toEqual([]);
    const ids = operations.map((op) => op.operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('les permissions des routes deviennent les scopes OAuth2', () => {
    const create = operations.find((op) => op.operationId === 'lists.create')!;
    expect(create.security).toEqual([{ oauth2: ['list:manage'] }]);
    expect(create.responses['201']).toBeDefined();
    const token = operations.find((op) => op.operationId === 'oAuth.token')!;
    expect(token.security).toEqual([]);
  });

  it('les références de schémas sont toutes résolues', () => {
    const refs = [...generated.matchAll(/"\$ref": "#\/components\/schemas\/([^"]+)"/g)].map(
      (match) => match[1]!,
    );
    expect(refs.filter((ref) => !(ref in document.components.schemas))).toEqual([]);
  });
});
