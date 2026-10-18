import { type MobileTile } from '@tesserax/sdk';
import { router } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SyncBar } from '@/components/sync-bar';
import { Button, Empty, styles } from '@/components/ui';
import { synchronize, useOffline } from '@/lib/offline';
import { profile } from '@/lib/profile';
import { brandColor, colors, font, radius, space } from '@/lib/theme';

/** Accueil : tuiles configurées dans le back-office (P2.7, P3.3), ou un formulaire par tuile. */
export default function Home() {
  const { store, settings, stats } = useOffline();
  const color = brandColor(settings);
  const structures = store.structures().filter((s) => s.currentVersionId);
  const configured = (settings?.['mobileMenu'] as MobileTile[] | undefined) ?? [];
  const tiles: MobileTile[] = configured.length
    ? configured.filter(
        (t) => t.kind !== 'structure' || structures.some((s) => s.id === t.structureId),
      )
    : [
        ...structures.map((s) => ({
          id: s.id,
          label: s.name,
          icon: 'clipboard',
          kind: 'structure' as const,
          structureId: s.id,
        })),
        { id: 'tasks', label: 'Mes tâches', icon: 'calendar', kind: 'tasks' as const },
        { id: 'mine', label: 'Mes fiches', icon: 'list', kind: 'submissions' as const },
        { id: 'scan', label: 'Scanner', icon: 'scan', kind: 'scan' as const },
      ];
  const open = (tile: MobileTile) => {
    if (tile.kind === 'structure' && tile.structureId)
      router.push(`/structure/${tile.structureId}`);
    else if (tile.kind === 'scan') router.push('/scan');
    else if (tile.kind === 'tasks') router.push('/tasks');
    else router.push('/submissions');
  };
  const me = profile();
  const unread = store.unreadNotifications();
  const openTasks = store.tasks({ open: true }).length;
  return (
    <SafeAreaView style={styles.screen}>
      <View
        style={{
          padding: space.lg,
          backgroundColor: color,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#fff', fontSize: font.xl, fontWeight: '700' }}>
            {String(settings?.['name'] ?? 'Tesserax')}
          </Text>
          {me?.firstName ? (
            <Text style={{ color: '#ffffffcc' }}>Bonjour {me.firstName}</Text>
          ) : null}
        </View>
        <Pressable
          onPress={() => router.push('/notifications')}
          accessibilityRole="button"
          accessibilityLabel={unread ? `Notifications, ${unread} non lues` : 'Notifications'}
          style={{
            borderWidth: 1,
            borderColor: '#ffffff88',
            borderRadius: radius.md,
            paddingHorizontal: space.md,
            paddingVertical: space.xs,
          }}
        >
          <Text style={{ color: '#fff', fontWeight: '700' }}>🔔 {unread}</Text>
        </Pressable>
      </View>
      <SyncBar />
      <ScrollView contentContainerStyle={styles.content}>
        {tiles.length === 0 && (
          <Empty title="Aucun formulaire disponible">
            Synchronisez l’appareil une première fois avec du réseau.
          </Empty>
        )}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
          {tiles.map((tile) => (
            <Pressable
              key={tile.id}
              onPress={() => open(tile)}
              accessibilityRole="button"
              style={({ pressed }) => ({
                width: '47%',
                minHeight: 110,
                borderRadius: radius.lg,
                padding: space.lg,
                justifyContent: 'flex-end',
                backgroundColor: tile.color ?? (tile.kind === 'structure' ? color : colors.surface),
                borderWidth: 1,
                borderColor: colors.border,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Text
                style={{
                  fontSize: font.lg,
                  fontWeight: '700',
                  color: tile.kind === 'structure' || tile.color ? '#fff' : colors.text,
                }}
              >
                {tile.label}
              </Text>
              {tile.kind === 'tasks' && openTasks > 0 ? (
                <Text style={{ color: tile.color ? '#fff' : colors.textMuted }}>
                  {openTasks} à faire
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>
        {stats.drafts > 0 && (
          <Text style={styles.muted}>{stats.drafts} brouillon(s) en cours.</Text>
        )}
        <Button
          title="Synchroniser maintenant"
          variant="outline"
          onPress={() => void synchronize()}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
