import { type InstanceSummary } from '@tesserax/sdk';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Card, Empty, Icon, styles } from '@/components/ui';
import { store, synchronize } from '@/lib/offline';
import { saveProfile } from '@/lib/profile';
import { client, currentInstance, setCurrentInstance } from '@/lib/session';
import { colors, radius, space } from '@/lib/theme';

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
  if (!apps) return <ActivityIndicator color={colors.accent} style={{ marginTop: space.xxl }} />;
  return (
    <ScrollView contentContainerStyle={styles.content}>
      {apps.length === 0 && <Empty title="Aucun espace accessible" />}
      {apps.map((app) => (
        <Pressable
          key={app.id}
          onPress={() => void choose(app)}
          accessibilityRole="button"
          accessibilityLabel={app.name}
          style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
        >
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: radius.md + 2,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: `${colors.primary}14`,
              }}
            >
              <Icon name="briefcase" size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 17, fontWeight: '600', color: colors.text }}>
                {app.name}
              </Text>
              <Text style={styles.muted}>{app.short}</Text>
            </View>
            <Icon name="chevron-right" size={18} color={colors.textMuted} />
          </Card>
        </Pressable>
      ))}
    </ScrollView>
  );
}
