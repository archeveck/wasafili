import { ApiError } from '@tesserax/sdk';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Field, Input, styles } from '@/components/ui';
import { t } from '@/lib/i18n';
import { client, serverUrl, setServerUrl } from '@/lib/session';
import { colors, space } from '@/lib/theme';

export default function Login() {
  const { expired } = useLocalSearchParams<{ expired?: string }>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
        <Text style={[styles.title, { color: colors.primary, fontSize: 32 }]}>{t('app.name')}</Text>
        <Text style={[styles.muted, { marginBottom: space.xl }]}>
          Collecte terrain, même sans réseau
        </Text>
        {expired ? (
          <Text style={[styles.error, { marginBottom: space.md }]}>
            Session expirée : reconnectez-vous. Vos fiches locales sont conservées.
          </Text>
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
            secureTextEntry
            textContentType="password"
            accessibilityLabel={t('auth.password')}
            testID="login-password"
            onSubmitEditing={() => void submit()}
          />
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
            <Button title="Serveur…" variant="ghost" onPress={() => setShowServer(true)} />
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
