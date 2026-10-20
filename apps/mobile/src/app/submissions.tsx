import { type SubmissionStatus } from '@wasafili/sync';
import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { SubmissionsMap } from '@/components/submissions-map';
import { SyncBar } from '@/components/sync-bar';
import { Empty, Input, shadow, STATUS } from '@/components/ui';
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
                borderColor: status === key ? STATUS[key]!.color : colors.border,
                borderRadius: 999,
                paddingHorizontal: space.md,
                paddingVertical: space.xs + 2,
                backgroundColor: status === key ? STATUS[key]!.color : colors.surface,
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: status === key }}
            >
              <Text
                style={{
                  color: status === key ? '#fff' : colors.text,
                  fontSize: 13,
                  fontWeight: '600',
                }}
              >
                {STATUS[key]!.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <View
          style={{
            flexDirection: 'row',
            gap: 2,
            padding: 3,
            borderRadius: radius.md + 2,
            backgroundColor: colors.subtle,
          }}
          accessibilityRole="tablist"
        >
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
              style={[
                {
                  flex: 1,
                  alignItems: 'center',
                  paddingVertical: space.sm,
                  borderRadius: radius.md,
                  backgroundColor: view === key ? colors.surface : 'transparent',
                },
                view === key && shadow.xs,
              ]}
            >
              <Text
                style={{
                  color: view === key ? colors.primary : colors.textMuted,
                  fontWeight: '600',
                }}
              >
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
          ListEmptyComponent={<Empty title="Aucune fiche" icon="search" />}
        />
      )}
    </View>
  );
}
