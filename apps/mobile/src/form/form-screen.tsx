import {
  availableTransitions,
  checkTransition,
  createFormEngine,
  type FieldState,
} from '@tesserax/form-engine';
import {
  errorsAt,
  type FormController,
  useFormEngine,
  validationMessage,
} from '@tesserax/form-renderer';
import {
  type Field,
  type SimpleField,
  type StructureDefinition,
  type TableField,
  type TableRow,
  initialState,
  walkFields,
  type WorkflowTransition,
} from '@tesserax/form-schema';
import { randomUUID } from 'expo-crypto';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { Badge, Button, Field as FieldRow, STATUS, styles } from '@/components/ui';
import { t } from '@/lib/i18n';
import { changed, store } from '@/lib/offline';
import { profile } from '@/lib/profile';
import { colors, font, radius, space } from '@/lib/theme';
import { NativeField } from './native-fields';
import { ReportButton } from './report-button';

interface Props {
  structureId: string;
  /** Fiche existante (brouillon ou synchronisée) ; absente : nouvelle fiche. */
  submissionId?: string;
  /** Valeurs initiales d'une nouvelle fiche (scan d'un équipement, tâche). */
  prefill?: Record<string, unknown>;
  /** Tâche dont la fiche est issue : elle sera close à l'envoi (P4.4.5). */
  taskId?: string;
}

function SimpleRow({
  field,
  state,
  value,
  onChange,
  path,
  scope,
  form,
  submissionId,
}: {
  field: SimpleField;
  state: FieldState;
  value: unknown;
  onChange: (value: unknown) => void;
  path: (string | number)[];
  scope: Record<string, unknown>;
  form: FormController;
  submissionId: string;
}) {
  if (!state.visible || field.type === 'hidden') return null;
  const errors = form.submitted ? errorsAt(form.errors, path) : [];
  const input = (
    <NativeField
      field={field}
      value={value}
      onChange={onChange}
      state={state}
      errors={errors}
      inputId={path.join('-')}
      scope={scope}
      submissionId={submissionId}
      userId={profile()?.id ?? null}
    />
  );
  if (field.type === 'info') {
    return (
      <View
        style={{
          backgroundColor: `${colors.accent}0f`,
          borderRadius: radius.md,
          borderLeftWidth: 3,
          borderLeftColor: colors.accent,
          padding: space.md,
          marginBottom: space.lg,
        }}
      >
        <Text style={{ fontWeight: '600', marginBottom: space.xs }}>{field.label}</Text>
        {input}
      </View>
    );
  }
  return (
    <FieldRow
      label={field.label}
      required={state.required}
      help={field.help}
      error={errors[0] ? validationMessage(errors[0], t) : undefined}
    >
      {input}
    </FieldRow>
  );
}

function TableBlock({
  table,
  form,
  submissionId,
}: {
  table: TableField;
  form: FormController;
  submissionId: string;
}) {
  const state = form.state.fields[table.key]!;
  if (!state.visible) return null;
  const rows = (Array.isArray(form.values[table.key]) ? form.values[table.key] : []) as TableRow[];
  const tableErrors = form.submitted ? errorsAt(form.errors, [table.key]) : [];
  return (
    <View style={{ marginBottom: space.lg, gap: space.sm }}>
      <Text style={{ fontSize: font.lg, fontWeight: '700' }}>
        {table.label}
        {state.required && <Text style={{ color: colors.danger }}> *</Text>}
      </Text>
      {rows.map((row, index) => (
        <View
          key={row._id}
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radius.lg,
            padding: space.md,
            backgroundColor: colors.surface,
            boxShadow: '0px 1px 2px rgba(14, 26, 46, 0.06)',
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: space.sm,
            }}
          >
            <Text style={[styles.muted, { fontWeight: '600' }]}>Ligne {index + 1}</Text>
            {!state.readOnly && (
              <Button
                title="Supprimer"
                variant="ghost"
                icon="trash-2"
                color={colors.danger}
                onPress={() => form.removeRow(table.key, index)}
                style={{ minHeight: 32 }}
              />
            )}
          </View>
          {table.fields.map((cell) => (
            <SimpleRow
              key={cell.id}
              field={cell}
              state={form.state.rows[table.key]?.[index]?.[cell.key] ?? state}
              value={row[cell.key]}
              onChange={(value) => form.setCell(table.key, index, cell.key, value)}
              path={[table.key, index, cell.key]}
              scope={row}
              form={form}
              submissionId={submissionId}
            />
          ))}
        </View>
      ))}
      {tableErrors[0] ? (
        <Text style={styles.error}>{validationMessage(tableErrors[0], t)}</Text>
      ) : null}
      {!state.readOnly && (table.maxRows === undefined || rows.length < table.maxRows) && (
        <Button
          title="Ajouter une ligne"
          variant="outline"
          icon="plus"
          onPress={() => form.addRow(table.key)}
        />
      )}
    </View>
  );
}

function Block({
  field,
  form,
  submissionId,
}: {
  field: Field;
  form: FormController;
  submissionId: string;
}) {
  if (field.type === 'table')
    return <TableBlock table={field} form={form} submissionId={submissionId} />;
  if (field.type === 'section') {
    if (!form.state.fields[field.key]?.visible) return null;
    return (
      <View
        style={{
          marginBottom: space.lg,
          padding: space.lg,
          paddingBottom: space.xs,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          boxShadow: '0px 1px 2px rgba(14, 26, 46, 0.06)',
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm,
            paddingBottom: space.md,
            marginBottom: space.lg,
            borderBottomWidth: 1,
            borderColor: colors.border,
          }}
        >
          <View style={{ width: 3, height: 18, borderRadius: 2, backgroundColor: colors.accent }} />
          <Text style={{ fontSize: font.lg, fontWeight: '700', color: colors.primary, flex: 1 }}>
            {field.label}
          </Text>
        </View>
        {field.fields.map((child) => (
          <Block key={child.id} field={child} form={form} submissionId={submissionId} />
        ))}
      </View>
    );
  }
  return (
    <SimpleRow
      field={field}
      state={form.state.fields[field.key]!}
      value={form.values[field.key]}
      onChange={(value) => form.setValue(field.key, value)}
      path={[field.key]}
      scope={form.values}
      form={form}
      submissionId={submissionId}
    />
  );
}

function Editor({
  definition,
  id,
  structureId,
  existing,
  prefill,
  taskId,
}: {
  definition: StructureDefinition;
  id: string;
  structureId: string;
  existing: ReturnType<typeof store.submission>;
  prefill?: Record<string, unknown>;
  taskId?: string;
}) {
  const me = profile();
  // Nouvelle fiche : état initial du workflow.
  const state = existing ? existing.state : initialState(definition.workflow);
  const context = useMemo(
    () => ({
      ...(me ? { user: { id: me.id, roles: me.roles } } : {}),
      state,
      timeZone: store.getMeta<{ timeZone?: string }>('settings')?.timeZone ?? 'Africa/Abidjan',
    }),
    [me, state],
  );
  const engine = useMemo(() => createFormEngine(definition), [definition]);
  const transitions = availableTransitions(definition.workflow, state, me?.roles ?? []);
  const draft = (data: Record<string, unknown>) =>
    store.saveDraft({
      id,
      structureId,
      data,
      location: location.current,
      ...(taskId ? { taskId } : {}),
    });
  const form = useFormEngine(definition, {
    context,
    newId: randomUUID,
    isNew: !existing,
    initialValues: existing?.data ?? prefill ?? {},
  });
  const isDraft = !existing || existing.status === 'draft';
  const location = useRef(existing?.location ?? null);
  const [saving, setSaving] = useState(false);
  // Hauteur du pied de page fixe (boutons) : le bas du formulaire reste atteignable.
  const [footer, setFooter] = useState(120);

  // Position de la saisie, relevée en arrière-plan sans bloquer (GPS seul, hors ligne).
  useEffect(() => {
    if (existing) return;
    void (async () => {
      const permission = await Location.getForegroundPermissionsAsync();
      if (!permission.granted) return;
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      }).catch(() => null);
      if (position)
        location.current = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };
    })();
  }, [existing]);

  // Brouillon enregistré automatiquement (P3.4.9) : rien n'est perdu si l'application s'arrête.
  useEffect(() => {
    if (!isDraft || !form.dirty) return;
    const timer = setTimeout(() => {
      draft(form.values);
      changed();
    }, 1200);
    return () => clearTimeout(timer);
    // `draft` ne dépend que des propriétés listées.
  }, [form.values, form.dirty, isDraft, id, structureId]);

  const send = () => {
    const result = form.submit();
    if (!result.valid) {
      Alert.alert('Fiche incomplète', `${result.errors.length} champ(s) à corriger.`);
      return;
    }
    setSaving(true);
    try {
      if (isDraft) {
        draft(result.values);
        store.submit(id, result.values);
      } else {
        store.edit(id, result.values);
      }
      changed();
      router.back();
    } finally {
      setSaving(false);
    }
  };

  // Bouton de workflow (P4.3) : vérifié localement, revérifié par le serveur à l'envoi.
  const runTransition = (transition: WorkflowTransition) => {
    const result = form.submit();
    if (!result.valid) {
      Alert.alert('Fiche incomplète', `${result.errors.length} champ(s) à corriger.`);
      return;
    }
    const check = checkTransition(engine, result.values, transition.key, context);
    if (!check.ok) {
      const labels = new Map(
        [...walkFields(definition.fields)].map(({ field }) => [field.key, field.label]),
      );
      const missing = [...new Set(check.errors.map((e) => labels.get(e.field) ?? e.field))];
      Alert.alert(
        transition.label,
        check.refusal
          ? 'Cette action n’est pas possible depuis l’état actuel.'
          : `À compléter : ${missing.join(', ')}`,
      );
      return;
    }
    const apply = () => {
      if (isDraft) draft(result.values);
      store.transition(id, { key: transition.key, to: transition.to }, result.values);
      changed();
      router.back();
    };
    if (transition.confirm) {
      Alert.alert(transition.label, transition.confirm, [
        { text: 'Annuler', style: 'cancel' },
        { text: transition.label, onPress: apply },
      ]);
    } else apply();
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: footer + space.lg }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
          {existing && (
            <Badge label={STATUS[existing.status]!.label} color={STATUS[existing.status]!.color} />
          )}
          {definition.workflow && state && (
            <Badge
              label={definition.workflow.states.find((s) => s.key === state)?.label ?? state}
              color={
                definition.workflow.states.find((s) => s.key === state)?.color ?? colors.textMuted
              }
            />
          )}
        </View>
        {existing?.error ? <Text style={styles.error}>{existing.error}</Text> : null}
        {existing && <ReportButton submission={existing} />}
        {definition.fields.map((field) => (
          <Block key={field.id} field={field} form={form} submissionId={id} />
        ))}
      </ScrollView>
      <View
        onLayout={(event) => setFooter(event.nativeEvent.layout.height)}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          gap: space.sm,
          padding: space.lg,
          backgroundColor: colors.surface,
          borderTopWidth: 1,
          borderColor: colors.border,
          boxShadow: '0px -4px 14px rgba(14, 26, 46, 0.06)',
        }}
      >
        {transitions.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {transitions.map((transition) => (
              <Button
                key={transition.key}
                title={transition.label}
                {...(transition.color ? { color: transition.color } : {})}
                style={{ flexGrow: 1 }}
                onPress={() => runTransition(transition)}
              />
            ))}
          </View>
        )}
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {isDraft && (
            <Button
              title="Brouillon"
              variant="outline"
              icon="save"
              style={{ flex: 1 }}
              onPress={() => {
                draft(form.values);
                changed();
                router.back();
              }}
            />
          )}
          <Button
            title={isDraft ? 'Envoyer' : 'Enregistrer'}
            icon={isDraft ? 'send' : 'check'}
            style={{ flex: 2 }}
            loading={saving}
            onPress={send}
          />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

/** Saisie d'une fiche (P3.4) : conditions, calculs et validation exécutés localement. */
export function FormScreen({ structureId, submissionId, prefill, taskId }: Props) {
  const existing = submissionId ? store.submission(submissionId) : undefined;
  const [id] = useState(() => submissionId ?? randomUUID());
  const version = existing ? store.version(existing.versionId) : store.currentVersion(structureId);
  if (!version) {
    return (
      <View style={styles.content}>
        <Text style={styles.title}>Formulaire indisponible</Text>
        <Text style={styles.muted}>Synchronisez l’appareil pour télécharger ce formulaire.</Text>
      </View>
    );
  }
  return (
    <Editor
      definition={version.definition}
      id={id}
      structureId={structureId}
      existing={existing}
      {...(prefill ? { prefill } : {})}
      {...(taskId ? { taskId } : {})}
    />
  );
}
