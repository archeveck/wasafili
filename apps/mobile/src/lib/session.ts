import { createClient, type TokenStore, type Tokens } from '@tesserax/sdk';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

const TOKENS = 'tesserax.tokens';
const INSTANCE = 'tesserax.instance';
const SERVER = 'tesserax.server';

/** Jetons dans le trousseau / keystore (chiffrés par le système). */
const tokenStore: TokenStore = {
  get() {
    const raw = SecureStore.getItem(TOKENS);
    return raw ? (JSON.parse(raw) as Tokens) : null;
  },
  set(tokens) {
    if (tokens) SecureStore.setItem(TOKENS, JSON.stringify(tokens));
    else void SecureStore.deleteItemAsync(TOKENS);
  },
};

/** Adresse de l'API : réglage de l'utilisateur, sinon configuration de build, sinon simulateur. */
export function serverUrl(): string {
  return (
    SecureStore.getItem(SERVER) ??
    (Constants.expoConfig?.extra?.['apiUrl'] as string | undefined) ??
    process.env['EXPO_PUBLIC_API_URL'] ??
    'http://localhost:3000'
  );
}

export function setServerUrl(url: string) {
  SecureStore.setItem(SERVER, url.replace(/\/+$/, ''));
  client = makeClient();
}

const listeners = new Set<() => void>();
export const onSessionExpired = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

function makeClient() {
  return createClient({
    baseUrl: serverUrl(),
    tokens: tokenStore,
    onSessionExpired: () => listeners.forEach((listener) => listener()),
  });
}

export let client = makeClient();

export const currentInstance = () => SecureStore.getItem(INSTANCE);
export const setCurrentInstance = (short: string | null) => {
  if (short) SecureStore.setItem(INSTANCE, short);
  else void SecureStore.deleteItemAsync(INSTANCE);
};
