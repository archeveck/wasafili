import { type Field, walkFields } from '@tesserax/form-schema';
import { type LocalListItem } from '@tesserax/sync';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { Button, Card, Empty, styles } from '@/components/ui';
import { ScannerModal } from '@/form/scanner';
import { useOffline } from '@/lib/offline';
import { space } from '@/lib/theme';

/**
 * Scan d'un équipement (P3.4.6) : recherche locale du code dans les référentiels, puis
 * nouvelle fiche pré-remplie avec l'équipement et ses parents (site, bâtiment…).
 */
export default function Scan() {
  const { store } = useOffline();
  const [scanning, setScanning] = useState(true);
  const [code, setCode] = useState<string>();
  const matches = code ? store.lookupCode(code) : [];

  const ancestors = (item: LocalListItem) => {
    const chain = [item];
    let parent = item.parentId;
    while (parent) {
      const found = store.listItems(item.listId, { limit: 5000 }).find((i) => i.id === parent);
      if (!found) break;
      chain.unshift(found);
      parent = found.parentId;
    }
    return chain;
  };

  /** Formulaires ayant un champ référentiel sur cette liste, et valeurs pré-remplies par niveau. */
  const targets = (item: LocalListItem) =>
    store
      .structures()
      .filter((s) => s.rights.includes('create') && s.currentVersionId)
      .flatMap((structure) => {
        const definition = store.version(structure.currentVersionId!)?.definition;
        const fields = [...walkFields(definition?.fields ?? [])]
          .filter(
            ({ field, table }) => !table && field.type === 'list' && field.listId === item.listId,
          )
          .map(({ field }) => field as Extract<Field, { type: 'list' }>);
        if (fields.length === 0) return [];
        const prefill: Record<string, string> = {};
        for (const ancestor of ancestors(item)) {
          const field =
            fields.find((f) => f.level === ancestor.level) ??
            (fields.length === 1 ? fields[0] : undefined);
          if (field) prefill[field.key] = ancestor.id;
        }
        return [{ structure, prefill }];
      });

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <ScannerModal
        visible={scanning}
        onCancel={() => {
          setScanning(false);
          if (!code) router.back();
        }}
        onScan={(data) => {
          setCode(data);
          setScanning(false);
        }}
      />
      {code && matches.length === 0 && (
        <Empty title={`Code « ${code} » inconnu`}>
          Aucun élément de référentiel ne porte ce code sur l’appareil.
        </Empty>
      )}
      {matches.map((item) => (
        <Card key={item.id} style={{ gap: space.sm }}>
          <Text style={styles.title}>{item.label}</Text>
          <Text style={styles.muted}>
            {ancestors(item)
              .slice(0, -1)
              .map((a) => a.label)
              .join(' › ')}
          </Text>
          {targets(item).map(({ structure, prefill }) => (
            <Button
              key={structure.id}
              icon="plus"
              title={`Nouvelle fiche : ${structure.name}`}
              onPress={() =>
                router.replace({
                  pathname: '/form/[structureId]',
                  params: { structureId: structure.id, prefill: JSON.stringify(prefill) },
                })
              }
            />
          ))}
        </Card>
      ))}
      <Button
        title="Scanner un autre code"
        variant="outline"
        icon="maximize"
        onPress={() => setScanning(true)}
      />
    </ScrollView>
  );
}
