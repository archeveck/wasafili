import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { randomToken, sha256 } from '../auth/crypto';
import { type Actor } from '../auth/decorators';
import { type OAuthClient } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { type Permission } from '../tenancy/permissions';

const NOT_FOUND = { error: 'not_found', message: 'Clé API introuvable' };

/** Préfixe des secrets : un secret divulgué se reconnaît (détection de secrets en CI). */
export const SECRET_PREFIX = 'wsfsk_';

export interface ApiClientInput {
  name: string;
  scopes: Permission[];
}

/**
 * Clés API (P7.1.4) : clients OAuth2 `client_credentials` d'une instance. Le secret n'est
 * stocké qu'en SHA-256 et n'est renvoyé qu'à la création et à la rotation. Une clé ne peut
 * recevoir que des permissions détenues par celui qui la crée ou la modifie. La révocation
 * et les changements de permissions s'appliquent dès la requête suivante (relecture du client
 * par `JwtAuthGuard`), sans attendre l'expiration des jetons émis.
 */
@Injectable()
export class ApiClientsService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const clients = await this.prisma.db.oAuthClient.findMany({
      orderBy: [{ revokedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'asc' }],
    });
    return { data: clients.map(toDto) };
  }

  async get(id: string) {
    return toDto(await this.find(id));
  }

  async create(instanceId: string, actor: Actor, input: ApiClientInput) {
    assertGrantable(actor, input.scopes);
    const secret = newSecret();
    const client = await this.prisma.db.oAuthClient.create({
      data: {
        instanceId,
        clientId: `wsf_${randomBytes(12).toString('hex')}`,
        secretHash: sha256(secret),
        name: input.name,
        scopes: [...new Set(input.scopes)].sort(),
      },
    });
    return { ...toDto(client), clientSecret: secret };
  }

  async update(id: string, actor: Actor, input: Partial<ApiClientInput>) {
    const client = await this.findActive(id);
    if (input.scopes) assertGrantable(actor, input.scopes);
    const updated = await this.prisma.db.oAuthClient.update({
      where: { id: client.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.scopes ? { scopes: [...new Set(input.scopes)].sort() } : {}),
      },
    });
    return toDto(updated);
  }

  /** Nouveau secret : l'ancien cesse de fonctionner (les jetons déjà émis restent valides). */
  async rotateSecret(id: string) {
    const client = await this.findActive(id);
    const secret = newSecret();
    const updated = await this.prisma.db.oAuthClient.update({
      where: { id: client.id },
      data: { secretHash: sha256(secret) },
    });
    return { ...toDto(updated), clientSecret: secret };
  }

  /** Révocation définitive ; la clé reste listée pour la traçabilité. Idempotent. */
  async revoke(id: string): Promise<void> {
    const client = await this.find(id);
    if (client.revokedAt) return;
    await this.prisma.db.oAuthClient.update({
      where: { id: client.id },
      data: { revokedAt: new Date() },
    });
  }

  private async find(id: string): Promise<OAuthClient> {
    const client = await this.prisma.db.oAuthClient.findUnique({ where: { id } });
    if (!client) throw new NotFoundException(NOT_FOUND);
    return client;
  }

  private async findActive(id: string): Promise<OAuthClient> {
    const client = await this.find(id);
    if (client.revokedAt) {
      throw new ConflictException({ error: 'revoked', message: 'Cette clé API est révoquée' });
    }
    return client;
  }
}

function newSecret(): string {
  return `${SECRET_PREFIX}${randomToken()}`;
}

/** Pas d'élévation de privilèges : on ne délègue que ce que l'on détient. */
function assertGrantable(actor: Actor, scopes: readonly string[]): void {
  const missing = scopes.filter((scope) => !actor.permissions.has(scope));
  if (missing.length > 0) {
    throw new ForbiddenException({
      error: 'forbidden',
      message: `Permission que vous ne détenez pas : ${missing.join(', ')}`,
    });
  }
}

function toDto(client: OAuthClient) {
  return {
    id: client.id,
    clientId: client.clientId,
    name: client.name,
    scopes: client.scopes,
    revokedAt: client.revokedAt,
    lastUsedAt: client.lastUsedAt,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
  };
}
