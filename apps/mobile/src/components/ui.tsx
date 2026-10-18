import { type ReactNode } from 'react';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  type PressableProps,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from 'react-native';
import { colors, font, radius, space } from '@/lib/theme';

export function Button({
  title,
  variant = 'primary',
  loading,
  color,
  style,
  ...props
}: PressableProps & {
  title: string;
  variant?: 'primary' | 'outline' | 'danger' | 'ghost';
  loading?: boolean;
  color?: string;
  style?: ViewStyle;
}) {
  const background =
    variant === 'primary'
      ? (color ?? colors.primary)
      : variant === 'danger'
        ? colors.danger
        : 'transparent';
  const foreground =
    variant === 'primary' || variant === 'danger' ? '#fff' : (color ?? colors.primary);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!props.disabled, busy: !!loading }}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: background,
          borderColor: variant === 'outline' ? colors.border : background,
          opacity: pressed || props.disabled ? 0.6 : 1,
        },
        style,
      ]}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={foreground} />
      ) : (
        <Text style={[styles.buttonText, { color: foreground }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  required,
  error,
  help,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string | undefined;
  help?: string | undefined;
  children: ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label}
        {required && <Text style={{ color: colors.danger }}> *</Text>}
      </Text>
      {children}
      {help && !error ? <Text style={styles.help}>{help}</Text> : null}
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function Input({ invalid, style, ...props }: TextInputProps & { invalid?: boolean }) {
  return (
    <TextInput
      placeholderTextColor={colors.textMuted}
      style={[
        styles.input,
        invalid && { borderColor: colors.danger },
        props.editable === false && { backgroundColor: colors.background },
        style,
      ]}
      {...props}
    />
  );
}

/**
 * Écran modal plein écran. Une `Modal` iOS est rendue hors de l'arbre du SafeAreaProvider de
 * l'application : il lui faut le sien, sinon le contenu passe sous l'encoche.
 */
export function ModalScreen({
  visible,
  onClose,
  children,
  onShow,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  onShow?: () => void;
}) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      {...(onShow ? { onShow } : {})}
    >
      <SafeAreaProvider>
        <SafeAreaView style={styles.screen}>{children}</SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Badge({ label, color = colors.textMuted }: { label: string; color?: string }) {
  return (
    <View style={[styles.badge, { borderColor: color, backgroundColor: `${color}1a` }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {children ? <Text style={styles.help}>{children}</Text> : null}
    </View>
  );
}

export const STATUS: Record<string, { label: string; color: string }> = {
  draft: { label: 'Brouillon', color: colors.textMuted },
  pending: { label: 'À envoyer', color: colors.warning },
  synced: { label: 'Envoyée', color: colors.success },
  error: { label: 'Erreur', color: colors.danger },
};

export const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: font.md, fontWeight: '600' },
  field: { gap: space.xs, marginBottom: space.lg },
  label: { fontSize: font.md, fontWeight: '600', color: colors.text },
  help: { fontSize: font.sm, color: colors.textMuted },
  error: { fontSize: font.sm, color: colors.danger },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    fontSize: font.md,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
  },
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: space.sm,
    paddingVertical: 2,
  },
  badgeText: { fontSize: font.sm, fontWeight: '600' },
  empty: { padding: space.xxl, alignItems: 'center', gap: space.sm },
  emptyTitle: { fontSize: font.lg, fontWeight: '600', color: colors.text },
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: space.lg, gap: space.md },
  title: { fontSize: font.xl, fontWeight: '700', color: colors.text },
  muted: { fontSize: font.sm, color: colors.textMuted },
});
