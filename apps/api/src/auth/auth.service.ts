import { Injectable } from '@nestjs/common';
import { OAuthError } from '../common/errors';
import { runWithContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { safeEqualHex, sha256, verifyPassword } from './crypto';
import { type TokenResponse, TokensService } from './tokens.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
  ) {}

  /** Grant `password` (apps web et mobile). */
  async passwordGrant(email: string, password: string): Promise<TokenResponse> {
    const user = await this.prisma.db.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    const valid = await verifyPassword(user?.passwordHash, password);
    if (!user || !valid || !user.isActive) {
      throw new OAuthError('invalid_grant', 'Identifiants invalides');
    }
    await this.prisma.db.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    return this.tokens.issueUserTokens(user.id);
  }

  /** Grant `client_credentials` (intégrations). Pas de refresh token : le client se réauthentifie. */
  async clientCredentialsGrant(clientId: string, clientSecret: string): Promise<TokenResponse> {
    // Seule lecture inter-instances autorisée par la RLS : le client en cours d'authentification.
    const client = await runWithContext({ oauthClientId: clientId }, () =>
      this.prisma.db.oAuthClient.findUnique({ where: { clientId } }),
    );
    if (!client || client.revokedAt || !safeEqualHex(sha256(clientSecret), client.secretHash)) {
      throw new OAuthError('invalid_client', 'Client inconnu ou secret invalide');
    }
    await runWithContext({ instanceId: client.instanceId }, () =>
      this.prisma.db.oAuthClient.update({
        where: { id: client.id },
        data: { lastUsedAt: new Date() },
      }),
    );
    const scope = client.scopes.join(' ');
    return {
      access_token: this.tokens.signAccessToken({
        sub: client.id,
        typ: 'client',
        inst: client.instanceId,
        scope,
      }),
      token_type: 'Bearer',
      expires_in: this.tokens.accessTokenTtl,
      scope,
    };
  }
}
