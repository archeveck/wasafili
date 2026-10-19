import { ApiError } from '@tesserax/sdk';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Field, Icon, Input, styles } from '@/components/ui';
import { t } from '@/lib/i18n';
import { client, serverUrl, setServerUrl } from '@/lib/session';
import { colors, font, radius, space } from '@/lib/theme';

export default function Login() {
  const { expired } = useLocalSearchParams<{ expired?: string }>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Afficher le mot de passe saisi (ASVS 2.1.12) : utile sur un clavier tactile, au soleil.
  const [revealed, setRevealed] = useState(false);
  const [server, setServer] = useState(serverUrl());
  const [showServer, setShowServer] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      if (server !== serverUrl()) setServerUrl(server);
      await client.login(email.trim(), password);
      router.replace('/instances');
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 400
          ? t('auth.invalidCredentials')
          : err instanceof TypeError
            ? 'Serveur injoignable : vérifiez la connexion.'
            : (err as Error).message,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'center', padding: space.xl }}
      >
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: radius.lg + 4,
            backgroundColor: colors.night,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: space.lg,
          }}
        >
          <Text style={{ color: '#fff', fontSize: 24, fontWeight: '700' }}>
            {t('app.name').charAt(0)}
          </Text>
        </View>
        <Text style={[styles.title, { color: colors.primary, fontSize: 30 }]}>{t('app.name')}</Text>
        <Text
          style={[
            styles.muted,
            { fontSize: font.md, marginTop: space.xs, marginBottom: space.xxl },
          ]}
        >
          Collecte terrain, même sans réseau
        </Text>
        {expired ? (
          <View
            style={{
              flexDirection: 'row',
              gap: space.sm,
              padding: space.md,
              marginBottom: space.lg,
              borderRadius: radius.md,
              backgroundColor: `${colors.warning}14`,
              borderWidth: 1,
              borderColor: `${colors.warning}40`,
            }}
          >
            <Icon name="clock" size={16} color={colors.warning} />
            <Text style={{ flex: 1, color: colors.text, fontSize: font.sm }}>
              Session expirée : reconnectez-vous. Vos fiches locales sont conservées.
            </Text>
          </View>
        ) : null}
        <Field label={t('auth.email')}>
          <Input
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="username"
            accessibilityLabel={t('auth.email')}
            testID="login-email"
          />
        </Field>
        <Field label={t('auth.password')} error={error}>
          <Input
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!revealed}
            autoCapitalize="none"
            textContentType="password"
            accessibilityLabel={t('auth.password')}
            testID="login-password"
            onSubmitEditing={() => void submit()}
          />
          <Pressable
            onPress={() => setRevealed((value) => !value)}
            accessibilityRole="switch"
            accessibilityState={{ checked: revealed }}
            accessibilityLabel="Afficher le mot de passe"
            testID="login-reveal"
            hitSlop={8}
            style={{ alignSelf: 'flex-end', paddingTop: space.xs }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
              <Icon name={revealed ? 'eye-off' : 'eye'} size={15} color={colors.accent} />
              <Text style={{ color: colors.accent, fontWeight: '600' }}>
                {revealed ? 'Masquer' : 'Afficher'}
              </Text>
            </View>
          </Pressable>
        </Field>
        <Button
          title={t('auth.login')}
          loading={busy}
          disabled={!email || !password}
          onPress={() => void submit()}
        />
        <View style={{ marginTop: space.xl }}>
          {showServer ? (
            <Field label="Adresse du serveur">
              <Input
                value={server}
                onChangeText={setServer}
                autoCapitalize="none"
                keyboardType="url"
                accessibilityLabel="Adresse du serveur"
              />
            </Field>
          ) : (
            <Button
              title="Serveur…"
              variant="ghost"
              icon="server"
              color={colors.textMuted}
              onPress={() => setShowServer(true)}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
