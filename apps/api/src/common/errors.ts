import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { type Response } from 'express';
import { Prisma } from '../generated/prisma/client';

export type OAuthErrorCode =
  'invalid_request' | 'invalid_client' | 'invalid_grant' | 'unsupported_grant_type';

/** Erreur de l'endpoint OAuth2, sérialisée au format RFC 6749 §5.2. */
export class OAuthError extends Error {
  constructor(
    readonly code: OAuthErrorCode,
    readonly description: string,
    readonly status: number = code === 'invalid_client'
      ? HttpStatus.UNAUTHORIZED
      : HttpStatus.BAD_REQUEST,
  ) {
    super(description);
  }
}

const CODES: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  429: 'too_many_requests',
};

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string;
  details?: unknown;
}

function fromHttpException(exception: HttpException): ErrorBody {
  const status = exception.getStatus();
  const response = exception.getResponse();
  const body: ErrorBody = {
    statusCode: status,
    error: CODES[status] ?? 'error',
    message: exception.message,
  };
  if (typeof response === 'object' && response !== null) {
    const { error, message, details } = response as Record<string, unknown>;
    // Les exceptions Nest standard portent `error` = libellé HTTP ; on garde nos codes.
    if (typeof error === 'string' && /^[a-z_]+$/.test(error)) body.error = error;
    if (typeof message === 'string') body.message = message;
    if (details !== undefined) body.details = details;
  }
  return body;
}

function fromPrismaError(exception: Prisma.PrismaClientKnownRequestError): ErrorBody | undefined {
  if (exception.code === 'P2002') {
    return { statusCode: 409, error: 'conflict', message: 'Cette ressource existe déjà' };
  }
  if (exception.code === 'P2025') {
    return { statusCode: 404, error: 'not_found', message: 'Ressource introuvable' };
  }
  return undefined;
}

/** Format d'erreur unique de l'API : `{ statusCode, error, message, details? }`. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof OAuthError) {
      res
        .status(exception.status)
        .json({ error: exception.code, error_description: exception.description });
      return;
    }

    let body: ErrorBody | undefined;
    if (exception instanceof HttpException) body = fromHttpException(exception);
    else if (exception instanceof Prisma.PrismaClientKnownRequestError)
      body = fromPrismaError(exception);

    if (!body) {
      this.logger.error(exception);
      body = { statusCode: 500, error: 'internal_error', message: 'Erreur interne' };
    }
    res.status(body.statusCode).json(body);
  }
}
