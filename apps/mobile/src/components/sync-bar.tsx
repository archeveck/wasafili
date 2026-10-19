import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { Icon, type IconName } from '@/components/ui';
import { useOffline } from '@/lib/offline';
import { colors, font, space } from '@/lib/theme';

/** Indicateur de synchronisation (P3.6) : hors ligne, envoi en cours, file, erreurs. */
export function SyncBar() {
  const { stats, busy, online, lastReport } = useOffline();
  const waiting = stats.pending + stats.uploadsPending;
  const problems = stats.failed + stats.uploadsFailed;
  const [text, color, icon]: [string, string, IconName] = problems
    ? [`${problems} envoi(s) en erreur — toucher pour voir`, colors.danger, 'alert-circle']
    : busy
      ? ['Synchronisation…', colors.accent, 'refresh-cw']
      : !online
        ? [
            waiting
              ? `Hors ligne — ${waiting} élément(s) en attente`
              : 'Hors ligne — saisie possible',
            colors.textMuted,
            'wifi-off',
          ]
        : waiting
          ? [`${waiting} élément(s) en attente d’envoi`, colors.warning, 'upload-cloud']
          : lastReport?.error
            ? ['Synchronisation interrompue — nouvel essai automatique', colors.warning, 'clock']
            : ['Tout est synchronisé', colors.success, 'check-circle'];
  return (
    <Pressable
      onPress={() => router.push('/sync')}
      accessibilityRole="button"
      accessibilityLabel={`État de la synchronisation : ${text}`}
    >
      {({ pressed }) => (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm,
            backgroundColor: `${color}${pressed ? '22' : '12'}`,
            borderBottomWidth: 1,
            borderColor: `${color}33`,
            paddingHorizontal: space.lg,
            paddingVertical: space.sm + 2,
          }}
        >
          <Icon name={icon} size={16} color={color} />
          <Text style={{ flex: 1, color, fontSize: font.sm, fontWeight: '600' }}>{text}</Text>
          <Icon name="chevron-right" size={16} color={color} />
        </View>
      )}
    </Pressable>
  );
}
