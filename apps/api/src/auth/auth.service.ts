import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { OAuthError } from '../common/errors';
import { runWithContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword, safeEqualHex, sha256, verifyPassword } from './crypto';
import { type TokenResponse, TokensService } from './tokens.service';

/** Origine d'une demande de jeton, pour le journal d'audit. */
export interface RequestOrigin {
  ip?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly audit: AuditService,
  ) {}

  /** Grant `password` (apps web et mobile). */
  async passwordGrant(
    email: string,
    password: string,
    origin: RequestOrigin = {},
  ): Promise<TokenResponse> {
    const user = await this.prisma.db.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    const valid = await verifyPassword(user?.passwordHash, password);
    if (!user || !valid || !user.isActive) {
      // Un e-mail inconnu n'appartient à aucune instance : rien à journaliser. L'écriture
      // n'est pas attendue : un compte existant ne doit pas se trahir par un refus plus lent.
      if (user) {
        void this.audit.recordForUser(user.id, {
          action: 'auth.login_failed',
          metadata: { reason: user.isActive ? 'invalid_password' : 'inactive' },
          ...origin,
        });
      }
      throw new OAuthError('invalid_grant', 'Identifiants invalides');
    }
    await this.prisma.db.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    await this.audit.recordForUser(user.id, { action: 'auth.login', ...origin });
    return this.tokens.issueUserTokens(user.id);
  }

  /** Grant `client_credentials` (intégrations). Pas de refresh token : le client se réauthentifie. */
  async clientCredentialsGrant(
    clientId: string,
    clientSecret: string,
    origin: RequestOrigin = {},
  ): Promise<TokenResponse> {
    // Seule lecture inter-instances autorisée par la RLS : le client en cours d'authentification.
    const client = await runWithContext({ oauthClientId: clientId }, () =>
      this.prisma.db.oAuthClient.findUnique({ where: { clientId } }),
    );
    if (!client || client.revokedAt || !safeEqualHex(sha256(clientSecret), client.secretHash)) {
      if (client) {
        void this.audit.record({
          instanceId: client.instanceId,
          action: 'auth.client_token_failed',
          actorClientId: client.id,
          metadata: { reason: client.revokedAt ? 'revoked' : 'invalid_secret' },
          ...origin,
        });
      }
      throw new OAuthError('invalid_client', 'Client inconnu ou secret invalide');
    }
    await runWithContext({ instanceId: client.instanceId }, () =>
      this.prisma.db.oAuthClient.update({
        where: { id: client.id },
        data: { lastUsedAt: new Date() },
      }),
    );
    await this.audit.record({
      instanceId: client.instanceId,
      action: 'auth.client_token',
      actorClientId: client.id,
      ...origin,
    });
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

  /**
   * Changement de mot de passe par l'utilisateur (ASVS 2.1.6) : l'ancien est exigé, puis toutes
   * les sessions sont fermées (refresh tokens révoqués) ; le client se reconnecte.
   */
  async changePassword(
    userId: string,
    current: string,
    next: string,
    origin: RequestOrigin = {},
  ): Promise<void> {
    const user = await this.prisma.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verifyPassword(user.passwordHash, current))) {
      throw new BadRequestException({
        error: 'invalid_password',
        message: 'Mot de passe actuel incorrect',
      });
    }
    if (current === next) {
      throw new BadRequestException({
        error: 'validation_failed',
        message: 'Le nouveau mot de passe doit être différent de l’actuel',
      });
    }
    await this.prisma.db.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(next) },
    });
    await this.tokens.revokeAllForUser(userId);
    await this.audit.recordForUser(userId, { action: 'auth.password_change', ...origin });
  }
}
