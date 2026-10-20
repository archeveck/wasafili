import { type ConfigContext, type ExpoConfig } from 'expo/config';

/**
 * Configuration dynamique (P7.3), au-dessus de `app.json`. Le profil EAS fixe `APP_VARIANT` :
 * les variantes development et preview s'installent à côté de l'application de production
 * (identifiant et nom distincts). Les cartes (MapLibre, fond auto-hébergé) n'ont pas de clé.
 */
const VARIANTS = {
  development: { suffix: '.dev', name: 'Wasafili (dev)' },
  preview: { suffix: '.preview', name: 'Wasafili (test)' },
  production: { suffix: '', name: 'Wasafili' },
} as const;

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = VARIANTS[(process.env['APP_VARIANT'] ?? 'production') as keyof typeof VARIANTS];
  if (!variant) throw new Error(`APP_VARIANT inconnu : ${process.env['APP_VARIANT']}`);
  return {
    ...config,
    name: variant.name,
    slug: config.slug ?? 'wasafili',
    ios: { ...config.ios, bundleIdentifier: `com.wasafili.app${variant.suffix}` },
    android: { ...config.android, package: `com.wasafili.app${variant.suffix}` },
  };
};
