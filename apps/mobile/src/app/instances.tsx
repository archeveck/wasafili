import { type InstanceSummary } from '@tesserax/sdk';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text } from 'react-native';
import { Card, Empty, styles } from '@/components/ui';
import { store, synchronize } from '@/lib/offline';
import { saveProfile } from '@/lib/profile';
import { client, currentInstance, setCurrentInstance } from '@/lib/session';
import { space } from '@/lib/theme';

/** Choix de l'instance ; changer d'instance efface les données locales de la précédente. */
export default function Instances() {
  const [apps, setApps] = useState<InstanceSummary[]>();
  const [error, setError] = useState<string>();

  const choose = async (app: InstanceSummary) => {
    if (currentInstance() && currentInstance() !== app.short) store.reset();
    setCurrentInstance(app.short);
    const me = await client.app(app.short).me();
    saveProfile({
      id: me.id,
      roles: me.roles,
      ...(me.firstName ? { firstName: me.firstName } : {}),
      ...(me.lastName ? { lastName: me.lastName } : {}),
      ...(me.email ? { email: me.email } : {}),
    });
    void synchronize();
    router.replace('/home');
  };

  useEffect(() => {
    client
      .apps()
      .then(async ({ data }) => {
        if (data.length === 1) await choose(data[0]!);
        else setApps(data);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) return <Empty title="Impossible de charger vos espaces">{error}</Empty>;
  if (!apps) return <ActivityIndicator style={{ marginTop: space.xxl }} />;
  return (
    <ScrollView contentContainerStyle={styles.content}>
      {apps.length === 0 && <Empty title="Aucun espace accessible" />}
      {apps.map((app) => (
        <Pressable key={app.id} onPress={() => void choose(app)} accessibilityRole="button">
          <Card>
            <Text style={{ fontSize: 17, fontWeight: '600' }}>{app.name}</Text>
            <Text style={styles.muted}>{app.short}</Text>
          </Card>
        </Pressable>
      ))}
    </ScrollView>
  );
}
