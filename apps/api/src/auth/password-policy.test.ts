import { describe, expect, it } from 'vitest';
import { passwordSchema } from './password-policy';

describe('politique de mot de passe', () => {
  it('exige 12 caractères, sans règle de composition', () => {
    expect(passwordSchema.safeParse('court-11car').success).toBe(false);
    expect(passwordSchema.safeParse('une phrase de passe').success).toBe(true);
    expect(passwordSchema.safeParse('Tesserax2026!').success).toBe(true);
  });

  it('refuse les mots de passe répandus et prévisibles', () => {
    expect(passwordSchema.safeParse('MotDePasse2026').success).toBe(false);
    expect(passwordSchema.safeParse('Azerty UIOP 123').success).toBe(false);
    expect(passwordSchema.safeParse('abababababab').success).toBe(false);
  });
});
