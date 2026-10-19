import Feather from '@expo/vector-icons/Feather';
import { type MobileTile } from '@tesserax/sdk';
import { router, useFocusEffect } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { useCallback } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SyncBar } from '@/components/sync-bar';
import { Button, Empty, Icon, type IconName, shadow, styles } from '@/components/ui';
import { synchronize, useOffline } from '@/lib/offline';
import { profile } from '@/lib/profile';
import { brandColor, colors, font, radius, space } from '@/lib/theme';

const sectionTitle = {
  fontSize: font.sm,
  fontWeight: '600' as const,
  color: colors.textMuted,
  textTransform: 'uppercase' as const,
  letterSpacing: 0.6,
};

/** Icônes des tuiles : noms Feather, alias des noms du back-office (Lucide), sinon selon le type. */
const ICON_ALIASES: Record<string, IconName> = {
  'clipboard-list': 'clipboard',
  scan: 'maximize',
  'scan-line': 'maximize',
  'qr-code': 'maximize',
  'calendar-days': 'calendar',
  'map-pinned': 'map-pin',
  'list-checks': 'check-square',
};
const KIND_ICONS: Record<MobileTile['kind'], IconName> = {
  structure: 'clipboard',
  tasks: 'calendar',
  submissions: 'list',
  scan: 'maximize',
  map: 'map',
};
function tileIcon(tile: MobileTile): IconName {
  if (tile.icon in Feather.glyphMap) return tile.icon as IconName;
  return ICON_ALIASES[tile.icon] ?? KIND_ICONS[tile.kind];
}

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
  // En-tête bleu nuit : barre d'état claire tant que l'accueil est affiché.
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('light');
      return () => setStatusBarStyle('dark');
    }, []),
  );
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.night }]} edges={['top']}>
      <View
        style={{
          paddingHorizontal: space.lg,
          paddingTop: space.md,
          paddingBottom: space.xl,
          backgroundColor: colors.night,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
        }}
      >
        <View style={{ flex: 1 }}>
          {me?.firstName ? (
            <Text style={{ color: '#A3B0C5', fontSize: font.sm }}>Bonjour {me.firstName}</Text>
          ) : null}
          <Text
            style={{ color: '#fff', fontSize: font.xl, fontWeight: '700', letterSpacing: -0.3 }}
            numberOfLines={1}
          >
            {String(settings?.['name'] ?? 'Tesserax')}
          </Text>
        </View>
        <Pressable
          onPress={() => router.push('/notifications')}
          accessibilityRole="button"
          accessibilityLabel={unread ? `Notifications, ${unread} non lues` : 'Notifications'}
          hitSlop={8}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: pressed ? '#ffffff2e' : '#ffffff1a',
          })}
        >
          <Icon name="bell" size={20} color="#fff" />
          {unread > 0 ? (
            <View
              style={{
                position: 'absolute',
                top: 4,
                right: 2,
                minWidth: 18,
                height: 18,
                borderRadius: 9,
                paddingHorizontal: 4,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.danger,
                borderWidth: 2,
                borderColor: colors.night,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>
                {unread > 99 ? '99+' : unread}
              </Text>
            </View>
          ) : null}
        </Pressable>
      </View>
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          borderTopLeftRadius: radius.lg + 8,
          borderTopRightRadius: radius.lg + 8,
          overflow: 'hidden',
        }}
      >
        <SyncBar />
        <ScrollView contentContainerStyle={[styles.content, { paddingTop: space.xl }]}>
          {tiles.length === 0 && (
            <Empty title="Aucun formulaire disponible" icon="download-cloud">
              Synchronisez l’appareil une première fois avec du réseau.
            </Empty>
          )}
          {tiles.length > 0 && <Text style={sectionTitle}>Accès rapide</Text>}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
            {tiles.map((tile) => {
              const tint = tile.color ?? (tile.kind === 'structure' ? color : colors.accent);
              const subtitle =
                tile.kind === 'tasks' && openTasks > 0 ? `${openTasks} à faire` : undefined;
              return (
                <Pressable
                  key={tile.id}
                  onPress={() => open(tile)}
                  accessibilityRole="button"
                  accessibilityLabel={subtitle ? `${tile.label}, ${subtitle}` : tile.label}
                  style={({ pressed }) => [
                    {
                      width: '47.5%',
                      minHeight: 124,
                      borderRadius: radius.lg,
                      padding: space.lg,
                      justifyContent: 'space-between',
                      gap: space.md,
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: pressed ? `${tint}66` : colors.border,
                      transform: [{ scale: pressed ? 0.98 : 1 }],
                    },
                    shadow.xs,
                  ]}
                >
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: radius.md + 2,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: `${tint}17`,
                    }}
                  >
                    <Icon name={tileIcon(tile)} size={20} color={tint} />
                  </View>
                  <View style={{ gap: 2 }}>
                    <Text
                      style={{ fontSize: font.md, fontWeight: '600', color: colors.text }}
                      numberOfLines={2}
                    >
                      {tile.label}
                    </Text>
                    {subtitle ? (
                      <Text style={{ fontSize: font.sm, color: colors.accent, fontWeight: '600' }}>
                        {subtitle}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
          {stats.drafts > 0 && (
            <Text style={styles.muted}>{stats.drafts} brouillon(s) en cours.</Text>
          )}
          <Button
            title="Synchroniser maintenant"
            variant="outline"
            icon="refresh-cw"
            style={{ marginTop: space.sm }}
            onPress={() => void synchronize()}
          />
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
