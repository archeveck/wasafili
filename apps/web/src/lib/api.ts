import { createClient, type TokenStore, type Tokens } from '@tesserax/sdk';

const KEY = 'tesserax.tokens';

/** Jetons en localStorage : la session survit au rechargement de la page. */
const tokenStore: TokenStore = {
  get() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as Tokens) : null;
    } catch {
      return null;
    }
  },
  set(tokens) {
    if (tokens) localStorage.setItem(KEY, JSON.stringify(tokens));
    else localStorage.removeItem(KEY);
  },
};

export const client = createClient({
  // Même origine que le back-office (proxy Vite en dev, nginx en conteneur).
  baseUrl: import.meta.env['VITE_API_URL'] ?? '',
  tokens: tokenStore,
  onSessionExpired: () => {
    if (!location.pathname.startsWith('/login')) {
      location.assign(`/login?redirect=${encodeURIComponent(location.pathname)}`);
    }
  },
});
