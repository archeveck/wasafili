import { z } from 'zod';

/**
 * Mots de passe parmi les plus répandus (listes publiques de fuites) et leurs variantes
 * locales évidentes : refusés quelle que soit leur longueur (ASVS 2.1.7, partiel : liste
 * embarquée, sans service externe).
 */
const COMMON = new Set([
  '123456789012',
  '1234567890123',
  'azertyuiopqs',
  'azertyuiop123',
  'qwertyuiop123',
  'motdepasse123',
  'motdepasse1234',
  'motdepasse2024',
  'motdepasse2025',
  'motdepasse2026',
  'password1234',
  'password12345',
  'password123456',
  'passwordpassword',
  'iloveyou1234',
  'administrateur',
  'administrator1',
  'admin1234567',
  'bienvenue1234',
  'bienvenue2026',
  'welcome12345',
  'soleil123456',
  'abidjan12345',
  'abidjan2026!',
  'cotedivoire225',
  'wasafili1234',
  'wasafili2026',
  'changeme1234',
  'qwerty123456',
  'aaaaaaaaaaaa',
  '000000000000',
  '111111111111',
]);

const normalize = (password: string) => password.toLowerCase().replace(/\s+/g, '');

/** Politique de mot de passe (ASVS 2.1.1–2.1.9) : 12 à 200 caractères, tous admis, pas de règle de composition. */
export const passwordSchema = z
  .string()
  .min(12, 'Au moins 12 caractères')
  .max(200, 'Au plus 200 caractères')
  .refine((password) => !COMMON.has(normalize(password)), 'Mot de passe trop répandu')
  .refine(
    (password) => new Set(normalize(password)).size >= 4,
    'Mot de passe trop prévisible (trop peu de caractères différents)',
  );
