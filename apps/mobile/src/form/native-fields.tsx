import DateTimePicker from '@react-native-community/datetimepicker';
import { type FieldProps } from '@tesserax/form-renderer';
import {
  type FieldOfType,
  type FileRef,
  type GeoPoint,
  type SimpleField,
  type SubmissionData,
} from '@tesserax/form-schema';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useState } from 'react';
import { Alert, FlatList, Image, Pressable, Switch, Text, View } from 'react-native';
import { Badge, Button, Input, ModalScreen, styles } from '@/components/ui';
import { enqueueFile, storeBytes, storePhoto, storePickedFile } from '@/lib/files';
import { store } from '@/lib/offline';
import { colors, font, radius, space } from '@/lib/theme';
import { DrawingModal } from './drawing';
import { ScannerModal } from './scanner';

export interface NativeFieldProps extends FieldProps {
  /** Valeurs de la portée courante (racine ou ligne de tableau) : cascade des référentiels. */
  scope: SubmissionData;
  submissionId: string;
  userId: string | null;
}

const chip = (active: boolean, color: string = colors.primary) => ({
  borderWidth: 1,
  borderColor: active ? color : colors.border,
  backgroundColor: active ? color : colors.surface,
  borderRadius: radius.md,
  paddingHorizontal: space.md,
  paddingVertical: space.sm,
  minHeight: 44,
  justifyContent: 'center' as const,
});

function ReadOnly({ text }: { text: string }) {
  return (
    <View style={[styles.input, { justifyContent: 'center', backgroundColor: colors.background }]}>
      <Text style={{ color: text ? colors.text : colors.textMuted, fontSize: font.md }}>
        {text || '—'}
      </Text>
    </View>
  );
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function DateInput({
  field,
  value,
  onChange,
  state,
}: NativeFieldProps & { field: FieldOfType<'date' | 'time' | 'datetime'> }) {
  const [open, setOpen] = useState(false);
  const text = typeof value === 'string' ? value : '';
  const asDate = () => {
    if (!text) return new Date();
    if (field.type === 'time') {
      const [h, m] = text.split(':').map(Number);
      const d = new Date();
      d.setHours(h ?? 0, m ?? 0, 0, 0);
      return d;
    }
    return new Date(field.type === 'date' ? `${text}T12:00:00` : text);
  };
  const display = !text
    ? ''
    : field.type === 'date'
      ? text.split('-').reverse().join('/')
      : field.type === 'time'
        ? text
        : new Date(text).toLocaleString('fr-FR');
  return (
    <View style={{ gap: space.sm }}>
      <Pressable
        disabled={state.readOnly}
        onPress={() => setOpen(!open)}
        accessibilityRole="button"
      >
        <ReadOnly text={display || 'Choisir…'} />
      </Pressable>
      {open && (
        <DateTimePicker
          value={asDate()}
          mode={field.type === 'datetime' ? 'datetime' : field.type}
          display="spinner"
          locale="fr-FR"
          onChange={(_event, date) => {
            if (!date) return;
            if (field.type === 'date')
              onChange(`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`);
            else if (field.type === 'time')
              onChange(`${pad(date.getHours())}:${pad(date.getMinutes())}`);
            else onChange(date.toISOString());
          }}
        />
      )}
      {open && <Button title="OK" variant="outline" onPress={() => setOpen(false)} />}
    </View>
  );
}

/** Choix dans un référentiel local, filtré par la valeur du champ parent (cascade, P3.4.2). */
function ListInput({
  field,
  value,
  onChange,
  state,
  scope,
}: NativeFieldProps & { field: FieldOfType<'list'> }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const parentId = field.parentField ? (scope[field.parentField] as string | undefined) : undefined;
  const waiting = Boolean(field.parentField && !parentId);
  const selected = typeof value === 'string' ? store.itemLabels([value]).get(value) : undefined;
  const items = open
    ? store.listItems(field.listId, {
        ...(parentId ? { parentId } : field.level === 0 ? { parentId: null } : {}),
        ...(field.level !== undefined ? { level: field.level } : {}),
        ...(q ? { q } : {}),
      })
    : [];
  return (
    <>
      <Pressable
        disabled={state.readOnly || waiting}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
      >
        <ReadOnly text={waiting ? 'Choisir d’abord le niveau parent' : (selected ?? 'Choisir…')} />
      </Pressable>
      <ModalScreen visible={open} onClose={() => setOpen(false)}>
        <View style={{ padding: space.lg, gap: space.md }}>
          <Text style={styles.title}>{field.label}</Text>
          <Input placeholder="Rechercher (libellé ou code)" value={q} onChangeText={setQ} />
        </View>
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => {
                onChange(item.id);
                setOpen(false);
                setQ('');
              }}
              style={{
                paddingHorizontal: space.lg,
                paddingVertical: space.md,
                borderBottomWidth: 1,
                borderColor: colors.border,
              }}
            >
              <Text style={{ fontSize: font.md, color: colors.text }}>{item.label}</Text>
              {item.code ? <Text style={styles.muted}>{item.code}</Text> : null}
            </Pressable>
          )}
          ListEmptyComponent={
            <Text style={[styles.muted, { padding: space.lg }]}>Aucun élément</Text>
          }
        />
        <View style={{ padding: space.lg, flexDirection: 'row', gap: space.sm }}>
          {value ? (
            <Button
              title="Effacer"
              variant="outline"
              style={{ flex: 1 }}
              onPress={() => {
                onChange(null);
                setOpen(false);
              }}
            />
          ) : null}
          <Button
            title="Fermer"
            variant="outline"
            style={{ flex: 1 }}
            onPress={() => setOpen(false)}
          />
        </View>
      </ModalScreen>
    </>
  );
}

/** Lien vers une fiche du formulaire cible, choisie parmi les fiches présentes sur l'appareil. */
function RelationInput({
  field,
  value,
  onChange,
  state,
}: NativeFieldProps & { field: FieldOfType<'relation'> }) {
  const [open, setOpen] = useState(false);
  const candidates = open ? store.submissions({ structureId: field.structureId, limit: 100 }) : [];
  const label = (data: SubmissionData) =>
    Object.values(data).find(
      (v): v is string => typeof v === 'string' && !/^[0-9a-f-]{36}$/.test(v) && !/^\d{4}-/.test(v),
    ) ?? 'Fiche';
  const ids = Array.isArray(value) ? (value as string[]) : typeof value === 'string' ? [value] : [];
  return (
    <>
      <Pressable disabled={state.readOnly} onPress={() => setOpen(true)} accessibilityRole="button">
        <ReadOnly text={ids.length ? `${ids.length} fiche(s) liée(s)` : 'Choisir…'} />
      </Pressable>
      <ModalScreen visible={open} onClose={() => setOpen(false)}>
        <Text style={[styles.title, { padding: space.lg }]}>{field.label}</Text>
        <FlatList
          data={candidates}
          keyExtractor={(s) => s.id}
          renderItem={({ item }) => {
            const active = ids.includes(item.id);
            return (
              <Pressable
                onPress={() => {
                  if (field.multiple)
                    onChange(active ? ids.filter((id) => id !== item.id) : [...ids, item.id]);
                  else {
                    onChange(item.id);
                    setOpen(false);
                  }
                }}
                style={{
                  padding: space.lg,
                  borderBottomWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: active ? `${colors.primary}1a` : undefined,
                }}
              >
                <Text style={{ fontSize: font.md }}>{label(item.data)}</Text>
                <Text style={styles.muted}>{new Date(item.updatedAt).toLocaleString('fr-FR')}</Text>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <Text style={[styles.muted, { padding: space.lg }]}>
              Aucune fiche de ce formulaire sur l’appareil
            </Text>
          }
        />
        <View style={{ padding: space.lg }}>
          <Button title="Fermer" variant="outline" onPress={() => setOpen(false)} />
        </View>
      </ModalScreen>
    </>
  );
}

function Thumb({
  file,
  onPress,
  onRemove,
}: {
  file: FileRef;
  onPress?: () => void;
  onRemove?: () => void;
}) {
  const uri = store.localFileUri(file.annotatedFileId ?? file.fileId);
  return (
    <View style={{ width: 88 }}>
      <Pressable
        onPress={onPress}
        accessibilityRole="imagebutton"
        accessibilityLabel="Annoter la photo"
      >
        {uri ? (
          <Image
            source={{ uri }}
            style={{
              width: 88,
              height: 88,
              borderRadius: radius.md,
              backgroundColor: colors.border,
            }}
          />
        ) : (
          <View
            style={{
              width: 88,
              height: 88,
              borderRadius: radius.md,
              backgroundColor: colors.border,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={styles.muted}>
              {file.mimeType?.startsWith('image/') ? 'Photo' : 'Fichier'}
            </Text>
          </View>
        )}
      </Pressable>
      {file.annotatedFileId ? <Badge label="Annotée" color={colors.danger} /> : null}
      {onRemove ? (
        <Button title="Retirer" variant="ghost" onPress={onRemove} style={{ minHeight: 32 }} />
      ) : null}
    </View>
  );
}

/** Photos (P3.4.3) : compression, conservation locale, annotation Skia (l'original est gardé). */
function PhotoInput({
  field,
  value,
  onChange,
  state,
  submissionId,
}: NativeFieldProps & { field: FieldOfType<'photo'> }) {
  const files = (value as FileRef[] | null) ?? [];
  const [annotating, setAnnotating] = useState<number>();
  const max = field.maxCount ?? 10;
  const add = async (source: 'camera' | 'library') => {
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted)
      return Alert.alert(
        'Autorisation refusée',
        'Autorisez l’accès dans les réglages du téléphone.',
      );
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsMultipleSelection: true,
            selectionLimit: max - files.length,
          });
    if (result.canceled) return;
    const stored = [];
    for (const asset of result.assets.slice(0, max - files.length)) {
      const photo = await storePhoto(asset.uri, {
        ...(field.quality ? { quality: field.quality } : {}),
        ...(field.maxDimension ? { maxDimension: field.maxDimension } : {}),
      });
      stored.push(enqueueFile(photo, submissionId));
    }
    onChange([...files, ...stored]);
  };
  const current = annotating !== undefined ? files[annotating] : undefined;
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {files.map((file, index) => (
          <Thumb
            key={file.fileId}
            file={file}
            {...(field.allowAnnotation !== false && !state.readOnly
              ? { onPress: () => setAnnotating(index) }
              : {})}
            {...(!state.readOnly
              ? { onRemove: () => onChange(files.filter((_, i) => i !== index)) }
              : {})}
          />
        ))}
      </View>
      {!state.readOnly && files.length < max && (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button
            title="Prendre une photo"
            variant="outline"
            style={{ flex: 1 }}
            onPress={() => void add('camera')}
          />
          {field.allowGallery ? (
            <Button title="Galerie" variant="outline" onPress={() => void add('library')} />
          ) : null}
        </View>
      )}
      <DrawingModal
        visible={current !== undefined}
        title="Annoter la photo"
        {...(current ? { backgroundUri: store.localFileUri(current.fileId) } : {})}
        onCancel={() => setAnnotating(undefined)}
        onSave={(png) => {
          const annotated = enqueueFile(storeBytes(png, 'image/png', 'png'), submissionId);
          onChange(
            files.map((f, i) =>
              i === annotating ? { ...f, annotatedFileId: annotated.fileId } : f,
            ),
          );
          setAnnotating(undefined);
        }}
      />
    </View>
  );
}

function FileInput({
  field,
  value,
  onChange,
  state,
  submissionId,
}: NativeFieldProps & { field: FieldOfType<'file'> }) {
  const files = (value as FileRef[] | null) ?? [];
  const pick = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      ...(field.accept ? { type: field.accept } : {}),
    });
    if (result.canceled) return;
    const asset = result.assets[0]!;
    const stored = storePickedFile(
      asset.uri,
      asset.name,
      asset.mimeType ?? 'application/octet-stream',
    );
    onChange([...files, enqueueFile(stored, submissionId)]);
  };
  return (
    <View style={{ gap: space.sm }}>
      {files.map((file, index) => (
        <View
          key={file.fileId}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <Text style={{ flex: 1 }}>{file.name ?? 'Fichier'}</Text>
          {!state.readOnly && (
            <Button
              title="Retirer"
              variant="ghost"
              onPress={() => onChange(files.filter((_, i) => i !== index))}
            />
          )}
        </View>
      ))}
      {!state.readOnly && files.length < (field.maxCount ?? 5) && (
        <Button title="Joindre un fichier" variant="outline" onPress={() => void pick()} />
      )}
    </View>
  );
}

function SignatureInput({ value, onChange, state, submissionId }: NativeFieldProps) {
  const [open, setOpen] = useState(false);
  const signature = value as FileRef | null;
  return (
    <View style={{ gap: space.sm }}>
      {signature ? <Thumb file={signature} /> : null}
      {!state.readOnly && (
        <Button
          title={signature ? 'Signer à nouveau' : 'Signer'}
          variant="outline"
          onPress={() => setOpen(true)}
        />
      )}
      <DrawingModal
        visible={open}
        title="Signature"
        onCancel={() => setOpen(false)}
        onSave={(png) => {
          onChange(enqueueFile(storeBytes(png, 'image/png', 'png'), submissionId));
          setOpen(false);
        }}
      />
    </View>
  );
}

/** Position GPS (P3.4.5) : coordonnées et précision, sans carte ni réseau (D4). */
function GeolocationInput({
  field,
  value,
  onChange,
  state,
}: NativeFieldProps & { field: FieldOfType<'geolocation'> }) {
  const point = value as GeoPoint | null;
  const [busy, setBusy] = useState(false);
  const locate = async () => {
    setBusy(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted)
        return Alert.alert('Autorisation refusée', 'La position est nécessaire pour ce champ.');
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      onChange({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        ...(position.coords.accuracy != null ? { accuracy: position.coords.accuracy } : {}),
        ...(position.coords.altitude != null ? { altitude: position.coords.altitude } : {}),
        source: 'gps',
        capturedAt: new Date(position.timestamp).toISOString(),
      });
    } catch {
      Alert.alert('Position indisponible', 'Réessayez à découvert, ou saisissez les coordonnées.');
    } finally {
      setBusy(false);
    }
  };
  const manual = (key: 'lat' | 'lng', text: string) => {
    const number = Number(text.replace(',', '.'));
    if (text === '' || Number.isNaN(number)) return;
    onChange({ lat: point?.lat ?? 0, lng: point?.lng ?? 0, source: 'manual', [key]: number });
  };
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Input
          style={{ flex: 1 }}
          placeholder="Latitude"
          keyboardType="numbers-and-punctuation"
          editable={!state.readOnly && field.allowManual !== false}
          defaultValue={point ? String(point.lat) : ''}
          onEndEditing={(e) => manual('lat', e.nativeEvent.text)}
          accessibilityLabel="Latitude"
        />
        <Input
          style={{ flex: 1 }}
          placeholder="Longitude"
          keyboardType="numbers-and-punctuation"
          editable={!state.readOnly && field.allowManual !== false}
          defaultValue={point ? String(point.lng) : ''}
          onEndEditing={(e) => manual('lng', e.nativeEvent.text)}
          accessibilityLabel="Longitude"
        />
      </View>
      {point?.accuracy != null ? (
        <Text style={styles.muted}>Précision : {Math.round(point.accuracy)} m</Text>
      ) : null}
      {!state.readOnly && (
        <Button
          title="Ma position"
          variant="outline"
          loading={busy}
          onPress={() => void locate()}
        />
      )}
    </View>
  );
}

function BarcodeInput({
  field,
  value,
  onChange,
  state,
  inputId,
}: NativeFieldProps & { field: FieldOfType<'barcode'> }) {
  const [scanning, setScanning] = useState(false);
  const code = typeof value === 'string' ? value : '';
  const match =
    field.lookupListId && code
      ? store.lookupCode(code).find((i) => i.listId === field.lookupListId)
      : undefined;
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Input
          nativeID={inputId}
          style={{ flex: 1 }}
          value={code}
          editable={!state.readOnly}
          onChangeText={(t) => onChange(t || null)}
          autoCapitalize="characters"
        />
        {!state.readOnly && (
          <Button title="Scanner" variant="outline" onPress={() => setScanning(true)} />
        )}
      </View>
      {match ? <Text style={styles.muted}>Reconnu : {match.label}</Text> : null}
      <ScannerModal
        visible={scanning}
        onCancel={() => setScanning(false)}
        onScan={(data) => {
          onChange(data);
          setScanning(false);
        }}
      />
    </View>
  );
}

/** Champ simple natif (P3.4.1), choisi selon le type ; même contrat que le web. */
export function NativeField(props: NativeFieldProps) {
  const { field, value, onChange, state, errors, userId } = props;
  const invalid = errors.length > 0;
  const text = typeof value === 'string' ? value : value == null ? '' : String(value);
  switch (field.type) {
    case 'text':
    case 'email':
    case 'phone':
      return (
        <Input
          value={text}
          invalid={invalid}
          editable={!state.readOnly}
          keyboardType={
            field.type === 'email'
              ? 'email-address'
              : field.type === 'phone'
                ? 'phone-pad'
                : 'default'
          }
          autoCapitalize={field.type === 'text' ? 'sentences' : 'none'}
          {...(field.type === 'text' && field.placeholder
            ? { placeholder: field.placeholder }
            : {})}
          onChangeText={(t) => onChange(t === '' ? null : t)}
          accessibilityLabel={field.label}
        />
      );
    case 'textarea':
      return (
        <Input
          value={text}
          invalid={invalid}
          editable={!state.readOnly}
          multiline
          style={{ minHeight: 96, textAlignVertical: 'top', paddingTop: space.md }}
          onChangeText={(t) => onChange(t === '' ? null : t)}
          accessibilityLabel={field.label}
        />
      );
    case 'number':
      return (
        <Input
          value={text}
          invalid={invalid}
          editable={!state.readOnly}
          keyboardType={field.decimals === 0 ? 'number-pad' : 'decimal-pad'}
          onChangeText={(t) => {
            const normalized = t.replace(',', '.');
            onChange(
              normalized === ''
                ? null
                : Number.isNaN(Number(normalized))
                  ? normalized
                  : Number(normalized),
            );
          }}
          accessibilityLabel={field.label}
        />
      );
    case 'slider': {
      const step = field.step ?? 1;
      const current = typeof value === 'number' ? value : field.min;
      return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Button
            title="−"
            variant="outline"
            disabled={state.readOnly || current <= field.min}
            onPress={() => onChange(Math.max(field.min, current - step))}
          />
          <Text style={{ fontSize: font.lg, minWidth: 64, textAlign: 'center' }}>
            {value == null ? '—' : `${current}${field.unit ? ` ${field.unit}` : ''}`}
          </Text>
          <Button
            title="+"
            variant="outline"
            disabled={state.readOnly || current >= field.max}
            onPress={() => onChange(Math.min(field.max, current + step))}
          />
        </View>
      );
    }
    case 'rating':
      return (
        <View style={{ flexDirection: 'row', gap: space.xs }} accessibilityRole="radiogroup">
          {Array.from({ length: field.max ?? 5 }, (_, i) => i + 1).map((n) => (
            <Pressable
              key={n}
              disabled={state.readOnly}
              onPress={() => onChange(value === n ? null : n)}
              accessibilityRole="radio"
              accessibilityState={{ checked: value === n }}
              accessibilityLabel={`${n} étoile(s)`}
            >
              <Text
                style={{
                  fontSize: 32,
                  color: typeof value === 'number' && value >= n ? colors.accent : colors.border,
                }}
              >
                ★
              </Text>
            </Pressable>
          ))}
        </View>
      );
    case 'date':
    case 'time':
    case 'datetime':
      return <DateInput {...props} field={field} />;
    case 'boolean':
      return (
        <Switch
          value={value === true}
          disabled={state.readOnly}
          onValueChange={onChange}
          trackColor={{ true: colors.primary }}
          accessibilityLabel={field.label}
        />
      );
    case 'select':
      return (
        <View
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}
          accessibilityRole="radiogroup"
        >
          {field.options.map((option) => {
            const active = value === option.value;
            return (
              <Pressable
                key={option.value}
                disabled={state.readOnly}
                onPress={() => onChange(active ? null : option.value)}
                style={chip(active, option.color)}
                accessibilityRole="radio"
                accessibilityState={{ checked: active }}
              >
                <Text
                  style={{
                    color: active ? '#fff' : colors.text,
                    fontWeight: active ? '600' : '400',
                  }}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      );
    case 'multiselect': {
      const selected = new Set((value as string[] | null) ?? []);
      return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {field.options.map((option) => {
            const active = selected.has(option.value);
            return (
              <Pressable
                key={option.value}
                disabled={state.readOnly}
                onPress={() => {
                  const next = new Set(selected);
                  if (active) next.delete(option.value);
                  else next.add(option.value);
                  onChange(
                    next.size ? field.options.map((o) => o.value).filter((v) => next.has(v)) : null,
                  );
                }}
                style={chip(active, option.color)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: active }}
              >
                <Text style={{ color: active ? '#fff' : colors.text }}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>
      );
    }
    case 'list':
      return <ListInput {...props} field={field} />;
    case 'relation':
      return <RelationInput {...props} field={field} />;
    case 'user':
      // Les membres ne sont pas synchronisés : l'utilisateur peut se désigner lui-même.
      return (
        <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
          <ReadOnly text={value ? (value === userId ? 'Moi' : 'Autre utilisateur') : ''} />
          {!state.readOnly && userId && (
            <Button
              title="Moi"
              variant="outline"
              onPress={() => onChange(field.multiple ? [userId] : userId)}
            />
          )}
        </View>
      );
    case 'photo':
      return <PhotoInput {...props} field={field} />;
    case 'file':
      return <FileInput {...props} field={field} />;
    case 'signature':
      return <SignatureInput {...props} />;
    case 'geolocation':
      return <GeolocationInput {...props} field={field} />;
    case 'barcode':
      return <BarcodeInput {...props} field={field} />;
    case 'calculated':
      return (
        <ReadOnly
          text={
            value == null
              ? ''
              : field.resultType === 'boolean'
                ? value
                  ? 'Oui'
                  : 'Non'
                : field.resultType === 'number'
                  ? new Intl.NumberFormat('fr-FR').format(value as number)
                  : String(value)
          }
        />
      );
    case 'timestamp':
      return (
        <ReadOnly
          text={value ? new Date(String(value)).toLocaleString('fr-FR') : 'Renseigné à l’envoi'}
        />
      );
    case 'author':
      return (
        <ReadOnly
          text={value ? (value === userId ? 'Moi' : 'Autre utilisateur') : 'Renseigné à l’envoi'}
        />
      );
    case 'info':
      return <Text style={{ color: colors.textMuted }}>{field.content}</Text>;
    case 'hidden':
      return null;
  }
}

export type { SimpleField };
