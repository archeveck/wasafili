/**
 * Design tokens Wasafili : bleu nuit, blanc et gris neutres, un bleu d'accent. Valeurs par
 * défaut d'une instance ; chaque instance peut surcharger `color.primary` et `color.accent`
 * (personnalisation, P2.7).
 */
export const tokens = {
  color: {
    primary: '#14284B',
    accent: '#2E6BE6',
    danger: '#C4372D',
    warning: '#D98A1B',
    success: '#2E8B57',
    text: '#0E1A2E',
    textMuted: '#5A6579',
    surface: '#FFFFFF',
    background: '#F4F6FA',
    border: '#DFE4EC',
    subtle: '#EEF2F7',
    /** Bleu nuit profond : en-têtes et navigation. */
    night: '#0B1A33',
  },
  radius: { sm: 4, md: 8, lg: 12 },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  font: {
    family: "'Inter', system-ui, sans-serif",
    size: { sm: 13, md: 15, lg: 18, xl: 24 },
  },
} as const;

export type Tokens = typeof tokens;
