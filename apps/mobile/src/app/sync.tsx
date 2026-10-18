import { router } from 'expo-router';
import { Alert, ScrollView, Text, View } from 'react-native';
import { Button, Card, styles } from '@/components/ui';
import { changed, synchronize, useOffline } from '@/lib/offline';
import { client, setCurrentInstance } from '@/lib/session';
import { colors, space } from '@/lib/theme';

/** File d'envoi et erreurs actionnables (P3.6). */
export default function Sync() {
  const { store, stats, busy, online, lastReport } = useOffline();
  const failed = store.failedMutations();
  const row = (label: string, value: string | number, color: string = colors.text) => (
    <View
      accessible
      accessibilityLabel={`${label} : ${value}`}
      style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: space.xs }}
    >
      <Text>{label}</Text>
      <Text style={{ fontWeight: '600', color }}>{value}</Text>
    </View>
  );
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Card>
        {row(
          'Réseau',
          online ? 'Connecté' : 'Hors ligne',
          online ? colors.success : colors.textMuted,
        )}
        {row(
          'Fiches et modifications à envoyer',
          stats.pending,
          stats.pending ? colors.warning : colors.text,
        )}
        {row(
          'Photos et fichiers à envoyer',
          stats.uploadsPending,
          stats.uploadsPending ? colors.warning : colors.text,
        )}
        {row('Brouillons', stats.drafts)}
        {row(
          'Envois refusés',
          stats.failed + stats.uploadsFailed,
          stats.failed ? colors.danger : colors.text,
        )}
        {row(
          'Dernière synchronisation',
          stats.lastSyncAt ? new Date(stats.lastSyncAt).toLocaleString('fr-FR') : 'Jamais',
        )}
        {lastReport?.error ? (
          <Text style={[styles.muted, { marginTop: space.sm }]}>
            Dernier essai : {lastReport.error}
          </Text>
        ) : null}
      </Card>
      <Button
        title={busy ? 'Synchronisation…' : 'Synchroniser maintenant'}
        loading={busy}
        onPress={() => void synchronize()}
      />
      {failed.length > 0 && (
        <>
          <Text style={[styles.title, { fontSize: 18, marginTop: space.md }]}>
            Envois refusés par le serveur
          </Text>
          {failed.map((mutation) => (
            <Card key={mutation.id} style={{ gap: space.sm }}>
              <Text style={{ fontWeight: '600' }}>
                {mutation.type === 'create'
                  ? 'Nouvelle fiche'
                  : mutation.type === 'update'
                    ? 'Modification'
                    : 'Suppression'}
              </Text>
              <Text style={styles.error}>{mutation.error}</Text>
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <Button
                  title="Corriger"
                  variant="outline"
                  style={{ flex: 1 }}
                  onPress={() => {
                    const submission = store.submission(mutation.submissionId);
                    if (submission)
                      router.push({
                        pathname: '/form/[structureId]',
                        params: { structureId: submission.structureId, id: submission.id },
                      });
                  }}
                />
                <Button
                  title="Abandonner"
                  variant="danger"
                  style={{ flex: 1 }}
                  onPress={() =>
                    Alert.alert(
                      'Abandonner cet envoi ?',
                      'La fiche revient à la dernière version du serveur.',
                      [
                        { text: 'Annuler', style: 'cancel' },
                        {
                          text: 'Abandonner',
                          style: 'destructive',
                          onPress: () => {
                            store.discardMutation(mutation.id);
                            changed();
                          },
                        },
                      ],
                    )
                  }
                />
              </View>
            </Card>
          ))}
          <Button
            title="Tout renvoyer"
            variant="outline"
            onPress={() => {
              store.retryFailed();
              changed();
            }}
          />
        </>
      )}
      <Button
        title="Se déconnecter"
        variant="ghost"
        style={{ marginTop: space.xl }}
        onPress={() => {
          const waiting = stats.pending + stats.uploadsPending + stats.drafts;
          Alert.alert(
            'Se déconnecter ?',
            waiting
              ? `${waiting} élément(s) non envoyé(s) seront perdus.`
              : 'Les données locales seront effacées.',
            [
              { text: 'Annuler', style: 'cancel' },
              {
                text: 'Se déconnecter',
                style: 'destructive',
                onPress: async () => {
                  await client.logout();
                  store.reset();
                  setCurrentInstance(null);
                  changed();
                  router.replace('/login');
                },
              },
            ],
          );
        }}
      />
    </ScrollView>
  );
}
