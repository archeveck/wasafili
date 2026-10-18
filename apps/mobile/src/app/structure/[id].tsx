import { router, Stack, useLocalSearchParams } from 'expo-router';
import { FlatList, Pressable, Text, View } from 'react-native';
import { SyncBar } from '@/components/sync-bar';
import { Badge, Button, Empty, STATUS, styles } from '@/components/ui';
import { type LocalSubmission } from '@tesserax/sync';
import { useOffline } from '@/lib/offline';
import { colors, space } from '@/lib/theme';

/** Résumé d'une fiche : premières valeurs textuelles, libellés de référentiel résolus. */
export function summary(
  store: ReturnType<typeof useOffline>['store'],
  submission: LocalSubmission,
): string {
  const values = Object.values(submission.data).filter(
    (v): v is string => typeof v === 'string' && v.length > 0,
  );
  const labels = store.itemLabels(values);
  return (
    values
      .map((v) => labels.get(v) ?? (/^[0-9a-f]{8}-/.test(v) ? '' : v))
      .filter(Boolean)
      .slice(0, 3)
      .join(' · ') || 'Fiche sans titre'
  );
}

export function SubmissionRow({ submission }: { submission: LocalSubmission }) {
  const { store } = useOffline();
  const status = STATUS[submission.status]!;
  return (
    <Pressable
      onPress={() =>
        router.push({
          pathname: '/form/[structureId]',
          params: { structureId: submission.structureId, id: submission.id },
        })
      }
      style={{
        backgroundColor: colors.surface,
        padding: space.lg,
        borderBottomWidth: 1,
        borderColor: colors.border,
        gap: space.xs,
      }}
      accessibilityRole="button"
    >
      <Text style={{ fontSize: 16, fontWeight: '600' }} numberOfLines={1}>
        {summary(store, submission)}
      </Text>
      <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
        <Badge label={status.label} color={status.color} />
        <Text style={styles.muted}>{new Date(submission.updatedAt).toLocaleString('fr-FR')}</Text>
      </View>
      {submission.error ? <Text style={styles.error}>{submission.error}</Text> : null}
    </Pressable>
  );
}

export default function StructureScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { store } = useOffline();
  const structure = store.structure(id);
  const submissions = store.submissions({ structureId: id });
  const canCreate = structure?.rights.includes('create') ?? false;
  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: structure?.name ?? 'Fiches' }} />
      <SyncBar />
      <FlatList
        data={submissions}
        keyExtractor={(s) => s.id}
        renderItem={({ item }) => <SubmissionRow submission={item} />}
        ListEmptyComponent={<Empty title="Aucune fiche sur l’appareil" />}
      />
      {canCreate && (
        <View style={{ padding: space.lg }}>
          <Button
            title="Nouvelle fiche"
            onPress={() =>
              router.push({ pathname: '/form/[structureId]', params: { structureId: id } })
            }
          />
        </View>
      )}
    </View>
  );
}
