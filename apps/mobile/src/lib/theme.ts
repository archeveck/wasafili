import { tokens } from '@tesserax/ui';

/** Thème mobile issu des tokens partagés ; la couleur primaire suit l'instance. */
export const colors = { ...tokens.color };
export const space = tokens.space;
export const radius = tokens.radius;
export const font = tokens.font.size;

export function brandColor(settings: Record<string, unknown> | null | undefined): string {
  const branding = settings?.['branding'] as { primaryColor?: string } | undefined;
  return branding?.primaryColor ?? colors.primary;
}
