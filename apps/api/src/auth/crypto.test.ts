import { describe, expect, it } from 'vitest';
import { hashPassword, randomToken, safeEqualHex, sha256, verifyPassword } from './crypto';

describe('mots de passe', () => {
  it('hash argon2id et vérifie', async () => {
    const hashed = await hashPassword('Secret#2026');
    expect(hashed).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hashed, 'Secret#2026')).toBe(true);
    expect(await verifyPassword(hashed, 'mauvais')).toBe(false);
  });

  it('refuse toujours un compte inexistant', async () => {
    expect(await verifyPassword(undefined, 'peu importe')).toBe(false);
  });
});

describe('jetons opaques', () => {
  it('génère des jetons uniques de 256 bits', () => {
    const token = randomToken();
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(randomToken()).not.toBe(token);
  });

  it('compare des empreintes en temps constant', () => {
    expect(safeEqualHex(sha256('a'), sha256('a'))).toBe(true);
    expect(safeEqualHex(sha256('a'), sha256('b'))).toBe(false);
    expect(safeEqualHex(sha256('a'), 'abcd')).toBe(false);
  });
});
