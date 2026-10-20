import { resources } from '@wasafili/i18n';

/** Traduction à partir des ressources partagées (fr par défaut), interpolation `{{param}}`. */
export function t(key: string, params: Record<string, unknown> = {}): string {
  const value = key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
      resources.fr.translation,
    );
  if (typeof value !== 'string') return key;
  return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params[name] ?? ''));
}
