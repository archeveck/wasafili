import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useOffline } from '@/lib/offline';
import { colors, font, space } from '@/lib/theme';

/** Indicateur de synchronisation (P3.6) : hors ligne, envoi en cours, file, erreurs. */
export function SyncBar() {
  const { stats, busy, online, lastReport } = useOffline();
  const waiting = stats.pending + stats.uploadsPending;
  const problems = stats.failed + stats.uploadsFailed;
  const [text, color] = problems
    ? [`${problems} envoi(s) en erreur — toucher pour voir`, colors.danger]
    : busy
      ? ['Synchronisation…', colors.primary]
      : !online
        ? [
            waiting
              ? `Hors ligne — ${waiting} élément(s) en attente`
              : 'Hors ligne — saisie possible',
            colors.textMuted,
          ]
        : waiting
          ? [`${waiting} élément(s) en attente d’envoi`, colors.warning]
          : lastReport?.error
            ? ['Synchronisation interrompue — nouvel essai automatique', colors.warning]
            : ['Tout est synchronisé', colors.success];
  return (
    <Pressable
      onPress={() => router.push('/sync')}
      accessibilityRole="button"
      accessibilityLabel={`État de la synchronisation : ${text}`}
    >
      <View
        style={{
          backgroundColor: `${color}1a`,
          borderBottomWidth: 1,
          borderColor: `${color}55`,
          paddingHorizontal: space.lg,
          paddingVertical: space.sm,
        }}
      >
        <Text style={{ color, fontSize: font.sm, fontWeight: '600' }}>{text}</Text>
      </View>
    </Pressable>
  );
}
