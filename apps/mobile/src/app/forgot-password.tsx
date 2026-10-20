import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { Button, Card, Field, Input, styles } from '@/components/ui';
import { t } from '@/lib/i18n';
import { client } from '@/lib/session';
import { colors, space } from '@/lib/theme';

/**
 * Mot de passe oublié (ASVS 2.5, ADR 0013) : le lien reçu par e-mail s'ouvre dans le navigateur
 * (back-office), où l'on choisit le nouveau mot de passe ; on revient ensuite se connecter ici.
 */
export default function ForgotPassword() {
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(params.email ?? '');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await client.requestPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      setError(
        err instanceof TypeError
          ? 'Serveur injoignable : vérifiez la connexion.'
          : (err as Error).message,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {sent ? (
        <Card style={{ gap: space.sm }}>
          <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>
            Si un compte existe pour {email.trim()}, un e-mail vient de lui être envoyé. Ouvrez le
            lien (valable 30 minutes) sur ce téléphone ou un ordinateur, choisissez le nouveau mot
            de passe, puis revenez vous connecter.
          </Text>
          <Text style={styles.muted}>Pensez à vérifier les courriers indésirables.</Text>
        </Card>
      ) : (
        <>
          <Text style={styles.muted}>
            Recevez par e-mail un lien pour choisir un nouveau mot de passe.
          </Text>
          <Field label={t('auth.email')} error={error}>
            <Input
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="username"
              accessibilityLabel={t('auth.email')}
              testID="forgot-email"
            />
          </Field>
          <Button
            title="Envoyer le lien"
            loading={busy}
            disabled={!email.trim()}
            onPress={() => void submit()}
          />
        </>
      )}
    </ScrollView>
  );
}
