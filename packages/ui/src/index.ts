/**
 * Design tokens Tesserax. Valeurs par défaut d'une instance ; chaque instance
 * peut surcharger `color.primary` et `color.accent` (personnalisation, P2.7).
 */
export const tokens = {
  color: {
    primary: '#1F6F5C',
    accent: '#E3A72F',
    danger: '#C4372D',
    warning: '#D98A1B',
    success: '#2E8B57',
    text: '#1B1F23',
    textMuted: '#5B6470',
    surface: '#FFFFFF',
    background: '#F5F6F4',
    border: '#D9DDD8',
  },
  radius: { sm: 4, md: 8, lg: 12 },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  font: {
    family: "'Inter', system-ui, sans-serif",
    size: { sm: 13, md: 15, lg: 18, xl: 24 },
  },
} as const;

export type Tokens = typeof tokens;
