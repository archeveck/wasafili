import { type Instance } from '../generated/prisma/client';

/** Appelant authentifié : un utilisateur (apps web/mobile) ou un client d'intégration. */
export type Principal =
  | { kind: 'user'; userId: string }
  | { kind: 'client'; clientId: string; instanceId: string; permissions: string[] };

/** Revendications des jetons d'accès émis par l'API. */
export interface AccessTokenClaims {
  sub: string;
  typ: 'user' | 'client';
  /** Instance du client (`typ = client` uniquement). */
  inst?: string;
  /** Permissions du client, séparées par des espaces (`typ = client` uniquement). */
  scope?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      principal?: Principal;
      instance?: Instance;
      permissions?: ReadonlySet<string>;
    }
  }
}
