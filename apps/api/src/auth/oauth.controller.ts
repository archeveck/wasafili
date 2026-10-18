import { Body, Controller, Header, Headers, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { z } from 'zod';
import { OAuthError } from '../common/errors';
import { AuthService } from './auth.service';
import { Public } from './decorators';
import { type TokenResponse, TokensService } from './tokens.service';

const tokenRequestSchema = z.discriminatedUnion('grant_type', [
  z.object({
    grant_type: z.literal('password'),
    username: z.string().min(1),
    password: z.string().min(1),
  }),
  z.object({ grant_type: z.literal('refresh_token'), refresh_token: z.string().min(1) }),
  z.object({
    grant_type: z.literal('client_credentials'),
    client_id: z.string().min(1).optional(),
    client_secret: z.string().min(1).optional(),
  }),
]);

const GRANT_TYPES = new Set(['password', 'refresh_token', 'client_credentials']);

/** Identifiants client via `Authorization: Basic` (RFC 6749 §2.3.1), prioritaires sur le corps. */
function basicCredentials(header: string | undefined): { id: string; secret: string } | undefined {
  if (!header?.startsWith('Basic ')) return undefined;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator < 0) return undefined;
  return {
    id: decodeURIComponent(decoded.slice(0, separator)),
    secret: decodeURIComponent(decoded.slice(separator + 1)),
  };
}

@Controller('oauth')
@Public()
export class OAuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokensService,
  ) {}

  /** Endpoint de jeton OAuth2 (corps JSON ou `application/x-www-form-urlencoded`). */
  @Post('token')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(ThrottlerGuard)
  async token(
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
  ): Promise<TokenResponse> {
    const grantType = (body as { grant_type?: unknown } | undefined)?.grant_type;
    if (typeof grantType === 'string' && !GRANT_TYPES.has(grantType)) {
      throw new OAuthError('unsupported_grant_type', `grant_type non supporté : ${grantType}`);
    }
    const parsed = tokenRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new OAuthError('invalid_request', 'Paramètres manquants ou invalides');
    }

    const request = parsed.data;
    switch (request.grant_type) {
      case 'password':
        return this.auth.passwordGrant(request.username, request.password);
      case 'refresh_token':
        return this.tokens.rotate(request.refresh_token);
      case 'client_credentials': {
        const basic = basicCredentials(authorization);
        const id = basic?.id ?? request.client_id;
        const secret = basic?.secret ?? request.client_secret;
        if (!id || !secret) throw new OAuthError('invalid_client', 'Identifiants client requis');
        return this.auth.clientCredentialsGrant(id, secret);
      }
    }
  }

  /** Révocation d'un refresh token (RFC 7009) : déconnexion de la session. Toujours 200. */
  @Post('revoke')
  @HttpCode(200)
  async revoke(@Body() body: unknown): Promise<Record<string, never>> {
    const token = (body as { token?: unknown } | undefined)?.token;
    if (typeof token === 'string' && token.length > 0) await this.tokens.revoke(token);
    return {};
  }
}
