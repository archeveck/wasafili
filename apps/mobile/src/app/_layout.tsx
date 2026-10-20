import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { startBasemapPrefetch } from '@/lib/basemap';
import { startSyncTriggers } from '@/lib/offline';
import { listenToNotificationTaps, registerPush } from '@/lib/push';
import { onSessionExpired } from '@/lib/session';
import { colors } from '@/lib/theme';

export default function RootLayout() {
  useEffect(() => {
    startSyncTriggers();
    startBasemapPrefetch();
    void registerPush();
    const stopTaps = listenToNotificationTaps();
    // Session expirée : reconnexion ; les données locales et la file d'envoi sont conservées.
    const stopExpired = onSessionExpired(() => router.replace('/login?expired=1'));
    return () => {
      stopTaps();
      stopExpired();
    };
  }, []);
  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerTintColor: colors.primary,
          headerStyle: { backgroundColor: colors.surface },
          headerTitleStyle: { color: colors.text, fontWeight: '600' },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
          headerBackTitle: 'Retour',
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="forgot-password" options={{ title: 'Mot de passe oublié' }} />
        <Stack.Screen name="instances" options={{ title: 'Espace de travail' }} />
        <Stack.Screen name="home" options={{ headerShown: false }} />
        <Stack.Screen name="structure/[id]" options={{ title: 'Fiches' }} />
        <Stack.Screen name="form/[structureId]" options={{ title: 'Saisie' }} />
        <Stack.Screen name="submissions" options={{ title: 'Mes fiches' }} />
        <Stack.Screen name="sync" options={{ title: 'Synchronisation' }} />
        <Stack.Screen name="scan" options={{ title: 'Scanner un équipement' }} />
        <Stack.Screen name="tasks" options={{ title: 'Mes tâches' }} />
        <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
      </Stack>
    </>
  );
}
