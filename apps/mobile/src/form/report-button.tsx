import { type LocalSubmission } from '@tesserax/sync';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Alert } from 'react-native';
import { Button } from '@/components/ui';
import { useOffline } from '@/lib/offline';
import { client, currentInstance } from '@/lib/session';
import { colors } from '@/lib/theme';

/**
 * Rapport PDF d'une fiche (P5.1.5), généré par le serveur : en ligne uniquement, pour une
 * fiche qu'il connaît. Le PDF reflète la dernière version envoyée.
 */
export function ReportButton({ submission }: { submission: LocalSubmission }) {
  const { online } = useOffline();
  const [busy, setBusy] = useState(false);
  if (submission.revision === null) return null;

  const open = async (reportId: string) => {
    const api = client.app(currentInstance()!);
    const { url } = await api.reports.render(reportId, submission.id);
    await WebBrowser.openBrowserAsync(url, { toolbarColor: colors.primary });
  };

  const run = async () => {
    setBusy(true);
    try {
      const api = client.app(currentInstance()!);
      const { data } = await api.reports.list(submission.structureId);
      if (data.length === 0) {
        Alert.alert('Rapport PDF', 'Aucun modèle de rapport pour ce formulaire.');
      } else if (data.length === 1) {
        await open(data[0]!.id);
      } else {
        Alert.alert('Rapport PDF', 'Choisissez le modèle', [
          ...data.slice(0, 3).map((report) => ({
            text: report.name,
            onPress: () => void open(report.id).catch(failed),
          })),
          { text: 'Annuler', style: 'cancel' as const },
        ]);
      }
    } catch (error) {
      failed(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      title={online ? 'Rapport PDF' : 'Rapport PDF (hors ligne)'}
      variant="outline"
      disabled={!online || busy}
      loading={busy}
      onPress={() => {
        if (submission.status === 'pending') {
          Alert.alert(
            'Rapport PDF',
            'Des modifications ne sont pas encore envoyées : le rapport montrera la dernière version reçue par le serveur.',
            [
              { text: 'Annuler', style: 'cancel' },
              { text: 'Continuer', onPress: () => void run() },
            ],
          );
        } else void run();
      }}
      accessibilityLabel="Rapport PDF"
    />
  );
}

function failed(error: unknown) {
  Alert.alert('Rapport PDF', (error as Error).message || 'Génération impossible');
}
