import Feather from '@expo/vector-icons/Feather';
import { type ComponentProps, type ReactNode, useState } from 'react';
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

export type IconName = ComponentProps<typeof Feather>['name'];

/** Icône décorative (jeu Feather, cousin de Lucide côté web) : ignorée par l'accessibilité. */
export function Icon({
  name,
  size = 20,
  color = colors.text,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  return (
    <Feather
      name={name}
      size={size}
      color={color}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

export function Button({
  title,
  variant = 'primary',
  loading,
  color,
  icon,
  style,
  ...props
}: PressableProps & {
  title: string;
  variant?: 'primary' | 'outline' | 'danger' | 'ghost';
  loading?: boolean;
  color?: string;
  icon?: IconName;
  style?: ViewStyle;
}) {
  const background =
    variant === 'primary'
      ? (color ?? colors.primary)
      : variant === 'danger'
        ? colors.danger
        : variant === 'outline'
          ? colors.surface
          : 'transparent';
  const foreground =
    variant === 'primary' || variant === 'danger' ? '#fff' : (color ?? colors.primary);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!props.disabled, busy: !!loading }}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: background,
          borderColor: variant === 'outline' ? colors.border : background,
          opacity: props.disabled ? 0.5 : pressed ? 0.82 : 1,
          transform: [{ scale: pressed && !props.disabled ? 0.985 : 1 }],
        },
        (variant === 'primary' || variant === 'danger' || variant === 'outline') && shadow.xs,
        style,
      ]}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={foreground} />
      ) : (
        <View style={styles.buttonInner}>
          {icon ? <Icon name={icon} size={18} color={foreground} /> : null}
          <Text style={[styles.buttonText, { color: foreground }]}>{title}</Text>
        </View>
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

export function Input({
  invalid,
  style,
  onFocus,
  onBlur,
  ...props
}: TextInputProps & { invalid?: boolean }) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      placeholderTextColor={colors.textMuted}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      style={[
        styles.input,
        focused && styles.inputFocused,
        invalid && { borderColor: colors.danger },
        props.editable === false && { backgroundColor: colors.subtle, color: colors.textMuted },
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
  return <View style={[styles.card, shadow.xs, style]}>{children}</View>;
}

export function Badge({ label, color = colors.textMuted }: { label: string; color?: string }) {
  return (
    <View style={[styles.badge, { borderColor: `${color}40`, backgroundColor: `${color}14` }]}>
      <View style={[styles.badgeDot, { backgroundColor: color }]} />
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

export function Empty({
  title,
  icon = 'inbox',
  children,
}: {
  title: string;
  icon?: IconName;
  children?: ReactNode;
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Icon name={icon} size={22} color={colors.textMuted} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {children ? <Text style={[styles.help, { textAlign: 'center' }]}>{children}</Text> : null}
    </View>
  );
}

export const STATUS: Record<string, { label: string; color: string }> = {
  draft: { label: 'Brouillon', color: colors.textMuted },
  pending: { label: 'À envoyer', color: colors.warning },
  synced: { label: 'Envoyée', color: colors.success },
  error: { label: 'Erreur', color: colors.danger },
};

/** Ombres légères teintées de bleu nuit (propriété `boxShadow`, nouvelle architecture). */
export const shadow = StyleSheet.create({
  xs: { boxShadow: '0px 1px 2px rgba(14, 26, 46, 0.06)' },
  md: { boxShadow: '0px 4px 14px rgba(14, 26, 46, 0.10)' },
});

export const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonInner: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  buttonText: { fontSize: font.md, fontWeight: '600' },
  field: { gap: 6, marginBottom: space.lg },
  label: { fontSize: font.sm + 1, fontWeight: '600', color: colors.text },
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
  inputFocused: { borderColor: colors.accent, borderWidth: 1.5 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
  },
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: space.sm + 2,
    paddingVertical: 3,
  },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: font.sm - 1, fontWeight: '600' },
  empty: { padding: space.xxl, alignItems: 'center', gap: space.sm },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.subtle,
    marginBottom: space.xs,
  },
  emptyTitle: { fontSize: font.lg, fontWeight: '600', color: colors.text },
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: space.lg, gap: space.md },
  title: { fontSize: font.xl, fontWeight: '700', color: colors.text, letterSpacing: -0.3 },
  muted: { fontSize: font.sm, color: colors.textMuted },
});
