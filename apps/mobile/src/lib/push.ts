import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Platform } from 'react-native';
import { store } from './offline';
import { client, currentInstance } from './session';

/**
 * Notifications push (P4.5, D1). Facultatives : toute notification arrive aussi par la
 * synchronisation dans le centre de notifications. Le jeton Expo exige un projet EAS
 * (`extra.eas.projectId`) ; sans lui, le push reste indisponible et rien d'autre ne change.
 */

const PREFERENCE = 'pushEnabled';
const TOKEN = 'pushToken';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export const pushEnabled = () => store.getMeta<boolean>(PREFERENCE) ?? true;

export type PushStatus = { ok: true } | { ok: false; reason: string };

/** Enregistre l'appareil (si l'utilisateur n'a pas désactivé le push). */
export async function registerPush(): Promise<PushStatus> {
  const instance = currentInstance();
  if (!pushEnabled() || !instance || !client.isAuthenticated()) {
    return { ok: false, reason: 'Désactivé' };
  }
  const projectId =
    (Constants.expoConfig?.extra?.['eas'] as { projectId?: string } | undefined)?.projectId ??
    Constants.easConfig?.projectId;
  if (!projectId) return { ok: false, reason: 'Push non configuré pour cette application' };
  if (Platform.OS === 'android') {
    // Android 13+ : un canal doit exister avant la demande d'autorisation et le jeton.
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Notifications',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const permission = await Notifications.getPermissionsAsync();
  const granted = permission.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return { ok: false, reason: 'Autorisation refusée dans les réglages du téléphone' };
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await client
      .app(instance)
      .notifications.registerPushToken(token, Platform.OS === 'ios' ? 'ios' : 'android');
    store.setMeta(TOKEN, token);
    return { ok: true };
  } catch {
    // Hors ligne ou service indisponible : nouvel essai au prochain démarrage.
    return { ok: false, reason: 'Enregistrement impossible pour le moment' };
  }
}

/** Préférence de l'utilisateur : coupe le push pour cet appareil (désenregistre le jeton). */
export async function setPushEnabled(enabled: boolean): Promise<PushStatus> {
  store.setMeta(PREFERENCE, enabled);
  if (enabled) return registerPush();
  const token = store.getMeta<string>(TOKEN);
  const instance = currentInstance();
  if (token && instance) {
    await client
      .app(instance)
      .notifications.unregisterPushToken(token)
      .catch(() => undefined);
  }
  store.setMeta(TOKEN, null);
  return { ok: false, reason: 'Désactivé' };
}

/** Ouverture de l'écran visé par une notification touchée. */
export function listenToNotificationTaps(): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const data = response.notification.request.content.data as {
      notificationId?: string;
      taskId?: string;
    };
    if (data.notificationId) store.markNotificationsRead(data.notificationId);
    router.push(data.taskId ? '/tasks' : '/notifications');
  });
  return () => subscription.remove();
}
