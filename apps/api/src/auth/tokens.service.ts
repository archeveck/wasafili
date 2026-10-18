import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { OAuthError } from '../common/errors';
import { ENV, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { randomToken, sha256 } from './crypto';
import { type AccessTokenClaims } from './principal';

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

/** Émission des jetons d'accès (JWT courts) et cycle de vie des refresh tokens rotatifs. */
@Injectable()
export class TokensService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  get accessTokenTtl(): number {
    return this.env.ACCESS_TOKEN_TTL;
  }

  signAccessToken(claims: AccessTokenClaims): string {
    return this.jwt.sign({ ...claims }, { expiresIn: this.env.ACCESS_TOKEN_TTL });
  }

  verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    return this.jwt.verifyAsync<AccessTokenClaims>(token);
  }

  /** Nouvelle paire de jetons ; sans `familyId`, ouvre une nouvelle session. */
  async issueUserTokens(userId: string, familyId: string = randomUUID()): Promise<TokenResponse> {
    const refreshToken = randomToken();
    await this.prisma.db.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + this.env.REFRESH_TOKEN_TTL * 1000),
      },
    });
    return {
      access_token: this.signAccessToken({ sub: userId, typ: 'user' }),
      token_type: 'Bearer',
      expires_in: this.env.ACCESS_TOKEN_TTL,
      refresh_token: refreshToken,
    };
  }

  /**
   * Échange un refresh token contre une nouvelle paire (rotation). Présenter un jeton déjà
   * échangé ou révoqué signale un vol probable : toute la famille (session) est révoquée.
   */
  async rotate(refreshToken: string): Promise<TokenResponse> {
    const db = this.prisma.db;
    const stored = await db.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: { user: { select: { isActive: true } } },
    });
    if (!stored) throw new OAuthError('invalid_grant', 'Refresh token invalide');

    if (stored.usedAt || stored.revokedAt) {
      await this.revokeFamily(stored.familyId);
      throw new OAuthError('invalid_grant', 'Refresh token déjà utilisé : session révoquée');
    }
    if (stored.expiresAt <= new Date() || !stored.user.isActive) {
      throw new OAuthError('invalid_grant', 'Refresh token expiré');
    }

    // Garde contre deux échanges concurrents du même jeton : un seul peut le consommer.
    const { count } = await db.refreshToken.updateMany({
      where: { id: stored.id, usedAt: null, revokedAt: null },
      data: { usedAt: new Date() },
    });
    if (count === 0) {
      await this.revokeFamily(stored.familyId);
      throw new OAuthError('invalid_grant', 'Refresh token déjà utilisé : session révoquée');
    }
    return this.issueUserTokens(stored.userId, stored.familyId);
  }

  /** Révocation (déconnexion) : invalide la session entière du jeton présenté. */
  async revoke(refreshToken: string): Promise<void> {
    const stored = await this.prisma.db.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      select: { familyId: true },
    });
    if (stored) await this.revokeFamily(stored.familyId);
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.db.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
