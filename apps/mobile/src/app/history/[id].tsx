import { displayValue, formatDateTime, stateLabel } from '@wasafili/form-renderer';
import { type Field, walkFields } from '@wasafili/form-schema';
import { type RevisionDto } from '@wasafili/sync';
import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, Text, View } from 'react-native';
import { Card, Empty, Icon, styles } from '@/components/ui';
import { useOffline } from '@/lib/offline';
import { colors, space } from '@/lib/theme';

const ACTIONS: Record<RevisionDto['action'], string> = {
  create: 'Création',
  update: 'Modification',
  transition: 'Changement d’état',
  delete: 'Suppression',
};

/**
 * Historique d'une fiche (spécification §1.4), lu dans la base locale : dernières révisions
 * reçues du serveur avec la fiche, consultables hors ligne. Les modifications pas encore
 * envoyées n'y figurent qu'après la synchronisation.
 */
export default function SubmissionHistory() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { store, settings } = useOffline();
  const submission = store.submission(id);
  const history = store.history(id);
  const definition = submission ? store.version(submission.versionId)?.definition : undefined;
  const timeZone = (settings?.['timeZone'] as string | undefined) ?? 'Africa/Abidjan';

  const { fields, labels, users } = useMemo(() => {
    const fields = new Map<string, Field>(
      [...walkFields(definition?.fields ?? [])].map(({ field }) => [field.key, field]),
    );
    const entries = history?.entries ?? [];
    const values = entries.flatMap((e) => e.changes.flatMap((c) => [c.before, c.after]));
    const labels = store.itemLabels(values.filter((v): v is string => typeof v === 'string'));
    // Noms connus de l'appareil : les auteurs des révisions.
    const users = new Map(
      entries.flatMap((e) => (e.authorId && e.author ? [[e.authorId, e.author] as const] : [])),
    );
    return { fields, labels, users };
  }, [definition, history, store]);

  if (!submission) return <Empty title="Fiche introuvable sur l’appareil" icon="alert-circle" />;
  if (submission.revision === null) {
    return (
      <Empty title="Fiche pas encore envoyée" icon="upload-cloud">
        <Text style={styles.muted}>L’historique commence à sa réception par le serveur.</Text>
      </Empty>
    );
  }

  const entries = history?.entries ?? [];
  const older = (history?.total ?? 0) - entries.length;
  return (
    <FlatList
      data={entries}
      keyExtractor={(entry) => String(entry.revision)}
      contentContainerStyle={styles.content}
      ListHeaderComponent={
        submission.status === 'pending' || submission.status === 'error' ? (
          <Card style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
            <Icon name="clock" color={colors.warning} />
            <Text style={{ flex: 1, color: colors.text }}>
              Des modifications faites sur l’appareil attendent l’envoi : elles apparaîtront ici
              après la synchronisation.
            </Text>
          </Card>
        ) : undefined
      }
      ListEmptyComponent={
        <Empty title="Historique pas encore reçu" icon="refresh-cw">
          <Text style={styles.muted}>Il arrive avec la prochaine synchronisation.</Text>
        </Empty>
      }
      ListFooterComponent={
        older > 0 ? (
          <Text style={[styles.muted, { textAlign: 'center' }]}>
            {older} révision(s) plus ancienne(s) : historique complet dans le back-office.
          </Text>
        ) : undefined
      }
      renderItem={({ item: entry }) => (
        <Card style={{ gap: space.sm }}>
          <View accessible>
            <Text style={{ fontWeight: '600', color: colors.text }}>
              {ACTIONS[entry.action] ?? entry.action} · révision {entry.revision}
            </Text>
            <Text style={styles.muted}>
              {entry.automation
                ? `Automatisation « ${entry.automation} »`
                : (entry.author ?? 'Intégration')}{' '}
              · {formatDateTime(entry.createdAt, timeZone)}
            </Text>
          </View>
          {entry.action === 'create' ? (
            <Text style={styles.muted}>{entry.changes.length} champ(s) renseigné(s)</Text>
          ) : (
            entry.changes.map((change) => {
              const field = fields.get(change.field);
              const [label, before, after] =
                change.field === '$state'
                  ? [
                      'État',
                      stateLabel(definition?.workflow, change.before as string | null),
                      stateLabel(definition?.workflow, change.after as string | null),
                    ]
                  : [
                      field?.label ?? change.field,
                      displayValue(field, change.before, labels, timeZone, users),
                      displayValue(field, change.after, labels, timeZone, users),
                    ];
              return (
                <View
                  key={change.field}
                  accessible
                  accessibilityLabel={`${label} : ${before} devient ${after}`}
                  style={{ borderTopWidth: 1, borderColor: colors.border, paddingTop: space.sm }}
                >
                  <Text style={{ fontWeight: '500', color: colors.text }}>{label}</Text>
                  <Text style={{ color: colors.danger, textDecorationLine: 'line-through' }}>
                    {before}
                  </Text>
                  <Text style={{ color: colors.success }}>{after}</Text>
                </View>
              );
            })
          )}
        </Card>
      )}
      ItemSeparatorComponent={() => <View style={{ height: space.md }} />}
    />
  );
}
