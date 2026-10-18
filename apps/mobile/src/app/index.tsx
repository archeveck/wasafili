import { Redirect } from 'expo-router';
import { client, currentInstance } from '@/lib/session';
import { store } from '@/lib/offline';

/** Hors ligne, une session ouverte et des données locales suffisent pour travailler. */
export default function Index() {
  if (!client.isAuthenticated() && !store.getMeta('profile')) return <Redirect href="/login" />;
  if (!currentInstance()) return <Redirect href="/instances" />;
  return <Redirect href="/home" />;
}
