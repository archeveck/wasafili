import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Request, type Response } from 'express';
import { tap, type Observable } from 'rxjs';
import { z } from 'zod';
import { OPENAPI, type OpenApiOptions } from '../src/openapi/openapi.decorator';
import { pageMeta } from '../src/openapi/resources';

/** Écarts entre les réponses réelles et leur schéma OpenAPI, relevés pendant les tests. */
export const contractViolations: string[] = [];

/** Schéma de réponse documenté d'une route (`@OpenApi`), ou rien. */
function responseSchema(options: OpenApiOptions | undefined): z.ZodType | undefined {
  if (options?.response) return options.response;
  if (options?.list) return z.object({ data: z.array(options.list) });
  if (options?.page) return z.object({ data: z.array(options.page), meta: pageMeta });
  return undefined;
}

/**
 * Contrat de l'API (P7.1.2), branché seulement dans les tests d'intégration : chaque réponse
 * de succès d'une route documentée doit respecter son schéma OpenAPI. La documentation ne peut
 * donc pas dériver du code sans qu'un test échoue.
 */
@Injectable()
export class ResponseContractInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const schema = responseSchema(
      this.reflector.get<OpenApiOptions | undefined>(OPENAPI, context.getHandler()),
    );
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    if (!schema || req.query['fields'] !== undefined) return next.handle();
    return next.handle().pipe(
      tap((body: unknown) => {
        if (http.getResponse<Response>().statusCode >= 300) return;
        // Forme JSON réelle : dates en chaînes ISO, `undefined` retirés.
        const result = schema.safeParse(JSON.parse(JSON.stringify(body ?? null)));
        if (!result.success) {
          contractViolations.push(
            `${req.method} ${req.route?.path ?? req.path} : ${z.prettifyError(result.error)}`,
          );
        }
      }),
    );
  }
}
