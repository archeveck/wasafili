import { type ConfigContext, type ExpoConfig } from 'expo/config';

/**
 * Configuration dynamique (P7.3), au-dessus de `app.json`. Le profil EAS fixe `APP_VARIANT` :
 * les variantes development et preview s'installent à côté de l'application de production
 * (identifiant et nom distincts). La clé Google Maps (cartes Android d'un build installé ;
 * inutile dans Expo Go et sur iOS, qui utilise Apple Plans) vient de `GOOGLE_MAPS_API_KEY`.
 */
const VARIANTS = {
  development: { suffix: '.dev', name: 'Wasafili (dev)' },
  preview: { suffix: '.preview', name: 'Wasafili (test)' },
  production: { suffix: '', name: 'Wasafili' },
} as const;

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = VARIANTS[(process.env['APP_VARIANT'] ?? 'production') as keyof typeof VARIANTS];
  if (!variant) throw new Error(`APP_VARIANT inconnu : ${process.env['APP_VARIANT']}`);
  const mapsKey = process.env['GOOGLE_MAPS_API_KEY'];
  return {
    ...config,
    name: variant.name,
    slug: config.slug ?? 'wasafili',
    ios: { ...config.ios, bundleIdentifier: `com.wasafili.app${variant.suffix}` },
    android: { ...config.android, package: `com.wasafili.app${variant.suffix}` },
    plugins: [
      ...(config.plugins ?? []),
      ...(mapsKey
        ? [['react-native-maps', { androidGoogleMapsApiKey: mapsKey }] as [string, object]]
        : []),
    ],
  };
};
