import { type SubmissionStatus } from '@tesserax/sync';
import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { SubmissionsMap } from '@/components/submissions-map';
import { SyncBar } from '@/components/sync-bar';
import { Empty, Input, STATUS } from '@/components/ui';
import { useOffline } from '@/lib/offline';
import { colors, radius, space } from '@/lib/theme';
import { SubmissionRow } from './structure/[id]';

/** Toutes les fiches de l'appareil, recherche plein texte locale (P3.3), en liste ou sur carte (P6.1.3). */
export default function Submissions() {
  const { store } = useOffline();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<SubmissionStatus>();
  const [view, setView] = useState<'list' | 'map'>('list');
  const submissions = store.submissions({ ...(q ? { q } : {}), ...(status ? { status } : {}) });
  return (
    <View style={{ flex: 1 }}>
      <SyncBar />
      <View style={{ padding: space.lg, gap: space.sm }}>
        <Input
          placeholder="Rechercher (site, équipement, texte…)"
          value={q}
          onChangeText={setQ}
          accessibilityLabel="Rechercher"
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
          {(Object.keys(STATUS) as SubmissionStatus[]).map((key) => (
            <Pressable
              key={key}
              onPress={() => setStatus(status === key ? undefined : key)}
              style={{
                borderWidth: 1,
                borderColor: STATUS[key]!.color,
                borderRadius: radius.md,
                paddingHorizontal: space.md,
                paddingVertical: space.xs,
                backgroundColor: status === key ? STATUS[key]!.color : colors.surface,
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: status === key }}
            >
              <Text style={{ color: status === key ? '#fff' : STATUS[key]!.color }}>
                {STATUS[key]!.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: space.xs }} accessibilityRole="tablist">
          {(
            [
              ['list', 'Liste'],
              ['map', 'Carte'],
            ] as const
          ).map(([key, label]) => (
            <Pressable
              key={key}
              onPress={() => setView(key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: view === key }}
              style={{
                flex: 1,
                alignItems: 'center',
                paddingVertical: space.sm,
                borderRadius: radius.md,
                backgroundColor: view === key ? colors.primary : colors.surface,
                borderWidth: 1,
                borderColor: view === key ? colors.primary : colors.border,
              }}
            >
              <Text style={{ color: view === key ? '#fff' : colors.text, fontWeight: '600' }}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      {view === 'map' ? (
        <SubmissionsMap submissions={submissions} />
      ) : (
        <FlatList
          data={submissions}
          keyExtractor={(s) => s.id}
          renderItem={({ item }) => <SubmissionRow submission={item} />}
          ListEmptyComponent={<Empty title="Aucune fiche" />}
        />
      )}
    </View>
  );
}
