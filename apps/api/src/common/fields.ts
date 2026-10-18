import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { type Request } from 'express';
import { map, type Observable } from 'rxjs';

/** Parse `fields=a,b` ; renvoie `undefined` si le paramètre est absent ou vide. */
export function parseFields(raw: unknown): string[] | undefined {
  if (typeof raw !== 'string') return undefined;
  const fields = raw
    .split(',')
    .map((field) => field.trim())
    .filter(Boolean);
  return fields.length > 0 ? fields : undefined;
}

function pick(value: unknown, fields: string[]): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const source = value as Record<string, unknown>;
  // `id` est toujours conservé pour que le client puisse référencer la ressource.
  return Object.fromEntries(
    ['id', ...fields].filter((key) => key in source).map((key) => [key, source[key]]),
  );
}

/**
 * Restreint les attributs renvoyés à ceux de `fields=` (premier niveau). S'applique aux
 * éléments de `data` pour une liste paginée, à l'objet lui-même sinon.
 */
export function selectFields(body: unknown, fields: string[]): unknown {
  if (body && typeof body === 'object' && 'data' in body && 'meta' in body) {
    const page = body as { data: unknown; meta: unknown };
    return {
      ...page,
      data: Array.isArray(page.data) ? page.data.map((item) => pick(item, fields)) : page.data,
    };
  }
  return pick(body, fields);
}

@Injectable()
export class FieldsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const fields = parseFields(context.switchToHttp().getRequest<Request>().query['fields']);
    return fields ? next.handle().pipe(map((body) => selectFields(body, fields))) : next.handle();
  }
}
