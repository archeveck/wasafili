import { type LocalNotification } from '@tesserax/sync';
import { router } from 'expo-router';
import { FlatList, Pressable, Text, View } from 'react-native';
import { Button, Empty, styles } from '@/components/ui';
import { changed, useOffline } from '@/lib/offline';
import { colors, radius, space } from '@/lib/theme';

/**
 * Centre de notifications (P4.5, D1) : alimenté par la synchronisation, il fonctionne sans
 * push. L'état « lu » reste sur l'appareil.
 */
export default function Notifications() {
  const { store, settings } = useOffline();
  const timeZone = (settings?.['timeZone'] as string | undefined) ?? 'Africa/Abidjan';
  const when = new Intl.DateTimeFormat('fr-FR', {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const notifications = store.notifications();

  const open = (notification: LocalNotification) => {
    store.markNotificationsRead(notification.id);
    changed();
    const { taskId, submissionId, structureId } = notification.data;
    if (taskId) router.push('/tasks');
    else if (submissionId && structureId && store.submission(submissionId))
      router.push({ pathname: '/form/[structureId]', params: { structureId, id: submissionId } });
  };

  return (
    <View style={{ flex: 1 }}>
      {notifications.some((n) => !n.read) && (
        <View style={{ padding: space.lg, paddingBottom: 0 }}>
          <Button
            title="Tout marquer comme lu"
            variant="outline"
            onPress={() => {
              store.markNotificationsRead();
              changed();
            }}
          />
        </View>
      )}
      <FlatList
        data={notifications}
        keyExtractor={(n) => n.id}
        contentContainerStyle={{ padding: space.lg, gap: space.sm }}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => open(item)}
            accessibilityRole="button"
            accessibilityLabel={`${item.read ? '' : 'Non lue, '}${item.title}`}
            style={({ pressed }) => ({
              padding: space.md,
              borderRadius: radius.md,
              backgroundColor: item.read ? colors.surface : `${colors.primary}12`,
              borderWidth: 1,
              borderColor: item.read ? colors.border : colors.primary,
              opacity: pressed ? 0.8 : 1,
              gap: 2,
            })}
          >
            <Text style={{ fontWeight: item.read ? '400' : '700' }}>{item.title}</Text>
            {item.body ? <Text>{item.body}</Text> : null}
            <Text style={styles.muted}>{when.format(new Date(item.createdAt))}</Text>
          </Pressable>
        )}
        ListEmptyComponent={<Empty title="Aucune notification" />}
      />
    </View>
  );
}
