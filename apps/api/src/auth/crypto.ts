import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Hash argon2id (paramètres par défaut de @node-rs/argon2, conformes aux recommandations OWASP). */
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

// Hash d'un mot de passe aléatoire : vérifié quand l'utilisateur n'existe pas, pour que la
// durée de réponse ne révèle pas l'existence d'un compte.
let dummyHash: Promise<string> | undefined;

export async function verifyPassword(passwordHash: string | undefined, password: string) {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  const target = passwordHash ?? (await dummyHash);
  const valid = await verify(target, password).catch(() => false);
  return valid && passwordHash !== undefined;
}

/** Jeton opaque de 256 bits (refresh tokens, secrets clients). */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Empreinte SHA-256 d'un jeton opaque. Suffisante pour des secrets aléatoires de 256 bits
 * (pas de force brute possible), et permet la recherche indexée.
 */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}
