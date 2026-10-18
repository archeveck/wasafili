import { type SubmissionStatus } from '@tesserax/sync';
import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { SyncBar } from '@/components/sync-bar';
import { Empty, Input, STATUS } from '@/components/ui';
import { useOffline } from '@/lib/offline';
import { colors, radius, space } from '@/lib/theme';
import { SubmissionRow } from './structure/[id]';

/** Toutes les fiches de l'appareil, recherche plein texte locale (P3.3). */
export default function Submissions() {
  const { store } = useOffline();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<SubmissionStatus>();
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
      </View>
      <FlatList
        data={submissions}
        keyExtractor={(s) => s.id}
        renderItem={({ item }) => <SubmissionRow submission={item} />}
        ListEmptyComponent={<Empty title="Aucune fiche" />}
      />
    </View>
  );
}
