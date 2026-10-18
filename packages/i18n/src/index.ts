import { en } from './en.js';
import { fr } from './fr.js';

export type { MessageTree } from './fr.js';

export const locales = ['fr', 'en'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'fr';
/** Fuseau d'affichage par défaut (D14) ; surchargeable par instance. */
export const defaultTimeZone = 'Africa/Abidjan';

/** Ressources au format i18next : `resources[locale].translation`. */
export const resources = {
  fr: { translation: fr },
  en: { translation: en },
} as const;
