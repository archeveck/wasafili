import { useQuery } from '@tanstack/react-query';
import { type DefinitionIssue, FORMULA_FUNCTIONS } from '@tesserax/form-engine';
import {
  COMPUTED_TYPES,
  type Field,
  FIELD_KEY_PATTERN,
  NON_VALUE_TYPES,
  type StructureDefinition,
  walkFields,
} from '@tesserax/form-schema';
import { Lock, Plus, Trash2 } from 'lucide-react';
import { type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Checklist } from '@/components/ui/checklist';
import { Checkbox, FormRow, Input, Select, Switch, Textarea } from '@/components/ui/form-controls';
import { useApp } from '@/lib/use-app';
import { slugify } from '@/lib/utils';
import { type ConditionTarget, ConditionEditor } from './condition-editor';
import { findField, typeLabel } from './model';

type AnyField = Field & Record<string, unknown>;

interface PropertiesProps {
  definition: StructureDefinition;
  fieldId: string;
  onChange: (patch: Record<string, unknown>) => void;
  /** Clés présentes dans la version publiée : non modifiables (les fiches les utilisent). */
  lockedKeys: Set<string>;
  issues: DefinitionIssue[];
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-3 border-t border-border pt-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>
      {children}
    </div>
  );
}

function Toggle({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="flex items-center justify-between gap-3 text-sm">
      {label}
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

function NumberInput({
  id,
  label,
  value,
  onChange,
  step,
}: {
  id: string;
  label: string;
  value: unknown;
  onChange: (v: number | undefined) => void;
  step?: string;
}) {
  return (
    <FormRow label={label} htmlFor={id}>
      <Input
        id={id}
        type="number"
        step={step ?? 'any'}
        value={(value as number | undefined) ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
    </FormRow>
  );
}

function OptionsEditor({
  field,
  onChange,
}: {
  field: AnyField;
  onChange: PropertiesProps['onChange'];
}) {
  const options = (field['options'] as { value: string; label: string; color?: string }[]) ?? [];
  const set = (next: typeof options) => onChange({ options: next });
  return (
    <div className="space-y-2">
      {options.map((option, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <Input
            aria-label={`Libellé de l’option ${index + 1}`}
            value={option.label}
            onChange={(e) => {
              const label = e.target.value;
              const autoValue =
                option.value === slugify(option.label) || /^option_\d+$/.test(option.value);
              set(
                options.map((o, i) =>
                  i === index
                    ? { ...o, label, ...(autoValue ? { value: slugify(label) } : {}) }
                    : o,
                ),
              );
            }}
          />
          <Input
            aria-label={`Valeur de l’option ${index + 1}`}
            className="w-28 font-mono text-xs"
            value={option.value}
            onChange={(e) =>
              set(options.map((o, i) => (i === index ? { ...o, value: e.target.value } : o)))
            }
          />
          <input
            type="color"
            aria-label={`Couleur de l’option ${index + 1}`}
            className="size-9 shrink-0 cursor-pointer rounded border border-border"
            value={option.color ?? '#5b6470'}
            onChange={(e) =>
              set(
                options.map((o, i) =>
                  i === index ? { ...o, color: e.target.value.toUpperCase() } : o,
                ),
              )
            }
          />
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Retirer l’option ${index + 1}`}
            disabled={options.length <= 1}
            onClick={() => set(options.filter((_, i) => i !== index))}
          >
            <Trash2 className="text-danger" />
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          set([
            ...options,
            { value: `option_${options.length + 1}`, label: `Option ${options.length + 1}` },
          ])
        }
      >
        <Plus /> Ajouter une option
      </Button>
    </div>
  );
}

function ListSettings({
  field,
  definition,
  onChange,
}: {
  field: AnyField;
  definition: StructureDefinition;
  onChange: PropertiesProps['onChange'];
}) {
  const { short, api } = useApp();
  const lists = useQuery({
    queryKey: [short, 'lists'],
    queryFn: () => api.lists.list({ perPage: 100 }),
  });
  const list = lists.data?.data.find((l) => l.id === field['listId']);
  const parents = [...walkFields(definition.fields)]
    .map(({ field: f }) => f as AnyField)
    .filter((f) => f.type === 'list' && f.id !== field.id && f['listId'] === field['listId']);
  return (
    <>
      <FormRow label="Référentiel" htmlFor="prop-list" required>
        <Select
          id="prop-list"
          value={(field['listId'] as string) ?? ''}
          onChange={(e) =>
            onChange({ listId: e.target.value, level: undefined, parentField: undefined })
          }
        >
          <option value="">— Choisir —</option>
          {lists.data?.data.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      </FormRow>
      {list && (
        <FormRow label="Niveau proposé" htmlFor="prop-level">
          <Select
            id="prop-level"
            value={field['level'] === undefined ? '' : String(field['level'])}
            onChange={(e) =>
              onChange({ level: e.target.value === '' ? undefined : Number(e.target.value) })
            }
          >
            <option value="">Tous les niveaux</option>
            {list.levels.map((level, index) => (
              <option key={level} value={index}>
                {level}
              </option>
            ))}
          </Select>
        </FormRow>
      )}
      <FormRow
        label="Cascade : filtré par le champ"
        htmlFor="prop-parent"
        help="Les éléments proposés sont les enfants de la valeur de ce champ."
      >
        <Select
          id="prop-parent"
          value={(field['parentField'] as string) ?? ''}
          onChange={(e) => onChange({ parentField: e.target.value || undefined })}
        >
          <option value="">Aucun</option>
          {parents.map((p) => (
            <option key={p.id} value={p.key}>
              {p.label}
            </option>
          ))}
        </Select>
      </FormRow>
    </>
  );
}

function RelationSettings({
  field,
  onChange,
}: {
  field: AnyField;
  onChange: PropertiesProps['onChange'];
}) {
  const { short, api } = useApp();
  const structures = useQuery({
    queryKey: [short, 'structures'],
    queryFn: () => api.structures.list({ perPage: 100 }),
  });
  return (
    <FormRow label="Formulaire lié" htmlFor="prop-structure" required>
      <Select
        id="prop-structure"
        value={(field['structureId'] as string) ?? ''}
        onChange={(e) => onChange({ structureId: e.target.value })}
      >
        <option value="">— Choisir —</option>
        {structures.data?.data.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </Select>
    </FormRow>
  );
}

function FormulaEditor({
  field,
  definition,
  issues,
  onChange,
}: {
  field: AnyField;
  definition: StructureDefinition;
  issues: DefinitionIssue[];
  onChange: PropertiesProps['onChange'];
}) {
  const found = findField(definition, field.id);
  const refs = [...walkFields(definition.fields)]
    .filter(
      ({ field: f }) => f.id !== field.id && !NON_VALUE_TYPES.has(f.type) && f.type !== 'section',
    )
    .map(({ field: f, table }) => ({
      label: f.label,
      // Colonne du même tableau : référence directe ; autre tableau : agrégat sur la colonne.
      ref: table && table.id !== found?.table?.id ? `{${table.key}.${f.key}}` : `{${f.key}}`,
    }));
  const errors = issues.filter(
    (issue) => issue.field === field.key && (issue.code === 'formula' || issue.code === 'cycle'),
  );
  return (
    <>
      <FormRow
        label="Formule"
        htmlFor="prop-formula"
        required
        error={errors[0]?.message.replace(`${field.key} : `, '')}
      >
        <Textarea
          id="prop-formula"
          className="font-mono text-xs"
          rows={3}
          value={(field['formula'] as string) ?? ''}
          onChange={(e) => onChange({ formula: e.target.value })}
          aria-invalid={errors.length > 0 || undefined}
        />
      </FormRow>
      <div className="space-y-1">
        <p className="text-xs text-muted">Insérer un champ :</p>
        <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto">
          {refs.map((r) => (
            <button
              key={r.ref}
              type="button"
              className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px] hover:border-primary"
              title={r.label}
              onClick={() =>
                onChange({ formula: `${(field['formula'] as string) ?? ''} ${r.ref}`.trim() })
              }
            >
              {r.ref}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted">
          Fonctions : {FORMULA_FUNCTIONS.join(', ')}. Séparateur « ; ». Ex. : SOMME({'{'}
          pieces.montant{'}'}), SI({'{'}etat{'}'} = "bon"; 0; 1).
        </p>
      </div>
      <FormRow label="Type de résultat" htmlFor="prop-result">
        <Select
          id="prop-result"
          value={(field['resultType'] as string) ?? 'number'}
          onChange={(e) => onChange({ resultType: e.target.value })}
        >
          <option value="number">Nombre</option>
          <option value="text">Texte</option>
          <option value="boolean">Oui / Non</option>
          <option value="date">Date</option>
        </Select>
      </FormRow>
      {field['resultType'] === 'number' && (
        <NumberInput
          id="prop-decimals"
          label="Décimales"
          step="1"
          value={field['decimals']}
          onChange={(v) => onChange({ decimals: v })}
        />
      )}
    </>
  );
}

function DefaultValue({
  field,
  onChange,
}: {
  field: AnyField;
  onChange: PropertiesProps['onChange'];
}) {
  const value = field['defaultValue'];
  switch (field.type) {
    case 'text':
    case 'textarea':
    case 'email':
    case 'phone':
    case 'hidden':
      return (
        <FormRow label="Valeur par défaut" htmlFor="prop-default">
          <Input
            id="prop-default"
            value={(value as string) ?? ''}
            onChange={(e) => onChange({ defaultValue: e.target.value || undefined })}
          />
        </FormRow>
      );
    case 'number':
    case 'slider':
    case 'rating':
      return (
        <NumberInput
          id="prop-default"
          label="Valeur par défaut"
          value={value}
          onChange={(v) => onChange({ defaultValue: v })}
        />
      );
    case 'boolean':
      return (
        <Toggle
          id="prop-default"
          label="Oui par défaut"
          checked={value === true}
          onChange={(v) => onChange({ defaultValue: v || undefined })}
        />
      );
    case 'select':
      return (
        <FormRow label="Valeur par défaut" htmlFor="prop-default">
          <Select
            id="prop-default"
            value={(value as string) ?? ''}
            onChange={(e) => onChange({ defaultValue: e.target.value || undefined })}
          >
            <option value="">Aucune</option>
            {((field['options'] as { value: string; label: string }[]) ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </FormRow>
      );
    case 'date':
    case 'time':
    case 'datetime':
      return (
        <Toggle
          id="prop-default-now"
          label={field.type === 'time' ? 'Heure courante par défaut' : 'Date du jour par défaut'}
          checked={field['defaultNow'] === true}
          onChange={(v) => onChange({ defaultNow: v || undefined })}
        />
      );
    default:
      return null;
  }
}

/** Réglages spécifiques au type (validation, options, référentiel…). */
function TypeSettings({
  field,
  definition,
  issues,
  onChange,
}: {
  field: AnyField;
  definition: StructureDefinition;
  issues: DefinitionIssue[];
  onChange: PropertiesProps['onChange'];
}) {
  const n = (key: string, label: string, step?: string) => (
    <NumberInput
      id={`prop-${key}`}
      label={label}
      value={field[key]}
      step={step}
      onChange={(v) => onChange({ [key]: v })}
    />
  );
  switch (field.type) {
    case 'text':
    case 'barcode':
      return (
        <>
          {field.type === 'text' && (
            <div className="grid grid-cols-2 gap-2">
              {n('minLength', 'Longueur min.', '1')}
              {n('maxLength', 'Longueur max.', '1')}
            </div>
          )}
          <FormRow
            label="Format (expression régulière)"
            htmlFor="prop-pattern"
            help="Ex. ^EQ-\d{4}$"
          >
            <Input
              id="prop-pattern"
              className="font-mono text-xs"
              value={(field['pattern'] as string) ?? ''}
              onChange={(e) => onChange({ pattern: e.target.value || undefined })}
            />
          </FormRow>
          <FormRow label="Message si format invalide" htmlFor="prop-pattern-message">
            <Input
              id="prop-pattern-message"
              value={(field['patternMessage'] as string) ?? ''}
              onChange={(e) => onChange({ patternMessage: e.target.value || undefined })}
            />
          </FormRow>
        </>
      );
    case 'textarea':
      return (
        <div className="grid grid-cols-2 gap-2">
          {n('minLength', 'Longueur min.', '1')}
          {n('maxLength', 'Longueur max.', '1')}
        </div>
      );
    case 'number':
      return (
        <>
          <div className="grid grid-cols-2 gap-2">
            {n('min', 'Minimum')}
            {n('max', 'Maximum')}
            {n('decimals', 'Décimales', '1')}
            <FormRow label="Unité" htmlFor="prop-unit">
              <Input
                id="prop-unit"
                value={(field['unit'] as string) ?? ''}
                onChange={(e) => onChange({ unit: e.target.value || undefined })}
              />
            </FormRow>
          </div>
        </>
      );
    case 'slider':
      return (
        <div className="grid grid-cols-3 gap-2">
          {n('min', 'Min.')}
          {n('max', 'Max.')}
          {n('step', 'Pas')}
        </div>
      );
    case 'rating':
      return n('max', 'Nombre d’étoiles', '1');
    case 'date':
      return (
        <div className="grid grid-cols-2 gap-2">
          <FormRow label="Au plus tôt" htmlFor="prop-min">
            <Input
              id="prop-min"
              type="date"
              value={(field['min'] as string) ?? ''}
              onChange={(e) => onChange({ min: e.target.value || undefined })}
            />
          </FormRow>
          <FormRow label="Au plus tard" htmlFor="prop-max">
            <Input
              id="prop-max"
              type="date"
              value={(field['max'] as string) ?? ''}
              onChange={(e) => onChange({ max: e.target.value || undefined })}
            />
          </FormRow>
        </div>
      );
    case 'boolean':
      return (
        <FormRow label="Affichage" htmlFor="prop-display">
          <Select
            id="prop-display"
            value={(field['display'] as string) ?? 'switch'}
            onChange={(e) => onChange({ display: e.target.value })}
          >
            <option value="switch">Interrupteur</option>
            <option value="checkbox">Case à cocher</option>
          </Select>
        </FormRow>
      );
    case 'select':
      return (
        <>
          <FormRow label="Affichage" htmlFor="prop-display">
            <Select
              id="prop-display"
              value={(field['display'] as string) ?? 'dropdown'}
              onChange={(e) => onChange({ display: e.target.value })}
            >
              <option value="dropdown">Liste déroulante</option>
              <option value="buttons">Boutons</option>
              <option value="radio">Boutons radio</option>
            </Select>
          </FormRow>
          <OptionsEditor field={field} onChange={onChange} />
        </>
      );
    case 'multiselect':
      return (
        <>
          <OptionsEditor field={field} onChange={onChange} />
          <div className="grid grid-cols-2 gap-2">
            {n('minItems', 'Choix min.', '1')}
            {n('maxItems', 'Choix max.', '1')}
          </div>
        </>
      );
    case 'list':
      return <ListSettings field={field} definition={definition} onChange={onChange} />;
    case 'relation':
      return (
        <>
          <RelationSettings field={field} onChange={onChange} />
          <Toggle
            id="prop-multiple"
            label="Plusieurs fiches"
            checked={field['multiple'] === true}
            onChange={(v) => onChange({ multiple: v || undefined })}
          />
        </>
      );
    case 'user':
      return (
        <Toggle
          id="prop-multiple"
          label="Plusieurs utilisateurs"
          checked={field['multiple'] === true}
          onChange={(v) => onChange({ multiple: v || undefined })}
        />
      );
    case 'photo':
      return (
        <>
          <div className="grid grid-cols-2 gap-2">
            {n('maxCount', 'Nombre max.', '1')}
            <FormRow
              label="Compression"
              htmlFor="prop-quality"
              help="Qualité JPEG sur mobile (0,1 à 1)"
            >
              <Input
                id="prop-quality"
                type="number"
                step="0.1"
                min={0.1}
                max={1}
                value={(field['quality'] as number) ?? ''}
                onChange={(e) =>
                  onChange({ quality: e.target.value === '' ? undefined : Number(e.target.value) })
                }
              />
            </FormRow>
          </div>
          <Toggle
            id="prop-annotation"
            label="Annotation / dessin"
            checked={field['allowAnnotation'] !== false}
            onChange={(v) => onChange({ allowAnnotation: v })}
          />
          <Toggle
            id="prop-gallery"
            label="Choisir depuis la galerie"
            checked={field['allowGallery'] === true}
            onChange={(v) => onChange({ allowGallery: v || undefined })}
          />
        </>
      );
    case 'file':
      return (
        <>
          {n('maxCount', 'Nombre max.', '1')}
          <FormRow
            label="Types acceptés"
            htmlFor="prop-accept"
            help="Séparés par des virgules, ex. application/pdf, image/*"
          >
            <Input
              id="prop-accept"
              value={((field['accept'] as string[]) ?? []).join(', ')}
              onChange={(e) => {
                const accept = e.target.value
                  .split(',')
                  .map((v) => v.trim())
                  .filter(Boolean);
                onChange({ accept: accept.length ? accept : undefined });
              }}
            />
          </FormRow>
        </>
      );
    case 'geolocation':
      return (
        <>
          <Toggle
            id="prop-manual"
            label="Saisie manuelle autorisée"
            checked={field['allowManual'] !== false}
            onChange={(v) => onChange({ allowManual: v })}
          />
          {n('maxAccuracy', 'Précision exigée (m)')}
        </>
      );
    case 'calculated':
      return (
        <FormulaEditor field={field} definition={definition} issues={issues} onChange={onChange} />
      );
    case 'timestamp':
      return (
        <FormRow label="Moment" htmlFor="prop-mode">
          <Select
            id="prop-mode"
            value={(field['mode'] as string) ?? 'created'}
            onChange={(e) => onChange({ mode: e.target.value })}
          >
            <option value="created">Création de la fiche</option>
            <option value="updated">Dernière modification</option>
          </Select>
        </FormRow>
      );
    case 'info':
      return (
        <FormRow label="Contenu" htmlFor="prop-content">
          <Textarea
            id="prop-content"
            rows={5}
            value={(field['content'] as string) ?? ''}
            onChange={(e) => onChange({ content: e.target.value })}
          />
        </FormRow>
      );
    case 'table':
      return (
        <div className="grid grid-cols-2 gap-2">
          {n('minRows', 'Lignes min.', '1')}
          {n('maxRows', 'Lignes max.', '1')}
        </div>
      );
    case 'section':
      return (
        <Toggle
          id="prop-collapsible"
          label="Repliable"
          checked={field['collapsible'] === true}
          onChange={(v) => onChange({ collapsible: v || undefined })}
        />
      );
    default:
      return null;
  }
}

/** Champs utilisables dans une condition : racine, et colonnes du même tableau via `$row`. */
function conditionTargets(definition: StructureDefinition, field: Field): ConditionTarget[] {
  const own = findField(definition, field.id);
  return [...walkFields(definition.fields)]
    .filter(
      ({ field: f }) => f.id !== field.id && !NON_VALUE_TYPES.has(f.type) && f.type !== 'table',
    )
    .flatMap(({ field: f, table }) => {
      if (!table) return [{ variable: f.key, label: f.label, field: f }];
      if (own?.table?.id === table.id)
        return [{ variable: `$row.${f.key}`, label: `${f.label} (ligne)`, field: f }];
      return [];
    });
}

/** Visibilité et modification par état de workflow et par rôle (P4.1.3, évaluées par form-engine). */
function StateAndRoleRules({
  definition,
  field,
  input,
  onChange,
}: {
  definition: StructureDefinition;
  field: AnyField;
  input: boolean;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const { api, short, can } = useApp();
  const roles = useQuery({
    queryKey: [short, 'roles'],
    queryFn: () => api.roles.list({ perPage: 100 }),
    enabled: can('role:read'),
  });
  const states = (definition.workflow?.states ?? []).map((s) => ({ value: s.key, label: s.label }));
  const roleOptions = (roles.data?.data ?? []).map((r) => ({ value: r.key, label: r.name }));
  const noWorkflow = 'Ajoutez un workflow à ce formulaire pour régler ces droits par état.';
  return (
    <Section title="Par état et par rôle">
      <p className="text-xs text-muted">Rien de coché : tous les états ou tous les rôles.</p>
      <div className="space-y-1">
        <p className="text-sm">Visible dans les états</p>
        <Checklist
          label="Visible dans les états"
          options={states}
          value={field.visibleInStates as string[] | undefined}
          onChange={(v) => onChange({ visibleInStates: v })}
          empty={noWorkflow}
        />
      </div>
      {input && (
        <div className="space-y-1">
          <p className="text-sm">Modifiable dans les états</p>
          <Checklist
            label="Modifiable dans les états"
            options={states}
            value={field.editableInStates as string[] | undefined}
            onChange={(v) => onChange({ editableInStates: v })}
            empty={noWorkflow}
          />
        </div>
      )}
      <div className="space-y-1">
        <p className="text-sm">Visible pour les rôles</p>
        <Checklist
          label="Visible pour les rôles"
          options={roleOptions}
          value={field.visibleToRoles as string[] | undefined}
          onChange={(v) => onChange({ visibleToRoles: v })}
        />
      </div>
      {input && (
        <div className="space-y-1">
          <p className="text-sm">Modifiable par les rôles</p>
          <Checklist
            label="Modifiable par les rôles"
            options={roleOptions}
            value={field.editableByRoles as string[] | undefined}
            onChange={(v) => onChange({ editableByRoles: v })}
          />
        </div>
      )}
    </Section>
  );
}

export function PropertiesPanel({
  definition,
  fieldId,
  onChange,
  lockedKeys,
  issues,
}: PropertiesProps) {
  const found = findField(definition, fieldId);
  if (!found) return null;
  const field = found.field as AnyField;
  const locked = lockedKeys.has(field.key);
  const valued = !NON_VALUE_TYPES.has(field.type);
  const input = valued && !COMPUTED_TYPES.has(field.type) && field.type !== 'hidden';
  const targets = conditionTargets(definition, field);
  const keyValid = FIELD_KEY_PATTERN.test(field.key);

  return (
    <div className="space-y-4" aria-label="Propriétés du champ">
      <div>
        <p className="text-xs text-muted">{typeLabel(field.type)}</p>
        <FormRow label="Libellé" htmlFor="prop-label" required>
          <Input
            id="prop-label"
            value={field.label}
            onChange={(e) => onChange({ label: e.target.value })}
          />
        </FormRow>
      </div>
      <FormRow
        label="Clé"
        htmlFor="prop-key"
        help={
          locked
            ? 'Utilisée par des fiches publiées : non modifiable.'
            : 'Identifiant dans les données, formules et rapports.'
        }
        error={keyValid ? undefined : 'Minuscules, chiffres et « _ », commence par une lettre'}
      >
        <div className="relative">
          <Input
            id="prop-key"
            className="pr-8 font-mono text-xs"
            value={field.key}
            disabled={locked}
            onChange={(e) => onChange({ key: e.target.value })}
          />
          {locked && <Lock className="absolute right-2.5 top-2.5 size-4 text-muted" />}
        </div>
      </FormRow>
      <FormRow label="Aide" htmlFor="prop-help">
        <Input
          id="prop-help"
          value={(field.help as string) ?? ''}
          onChange={(e) => onChange({ help: e.target.value || undefined })}
        />
      </FormRow>

      {(input || field.type === 'table') && (
        <div className="space-y-2">
          <Toggle
            id="prop-required"
            label="Obligatoire"
            checked={field.required === true}
            onChange={(v) => onChange({ required: v || undefined })}
          />
          {input && (
            <Toggle
              id="prop-readonly"
              label="Lecture seule"
              checked={field.readOnly === true}
              onChange={(v) => onChange({ readOnly: v || undefined })}
            />
          )}
          {!found.table && valued && field.type !== 'table' && (
            <label className="flex items-center justify-between gap-3 text-sm">
              Filtrable dans les listes de fiches
              <Checkbox
                checked={field.filterable === true}
                onCheckedChange={(v) => onChange({ filterable: v === true || undefined })}
              />
            </label>
          )}
        </div>
      )}

      <TypeSettings field={field} definition={definition} issues={issues} onChange={onChange} />
      {input && <DefaultValue field={field} onChange={onChange} />}

      <Section title="Visible si">
        <ConditionEditor
          idPrefix="visible"
          value={field.visibleIf as never}
          onChange={(logic) => onChange({ visibleIf: logic })}
          targets={targets}
        />
      </Section>
      {input && (
        <Section title="Obligatoire si">
          <ConditionEditor
            idPrefix="required"
            value={field.requiredIf as never}
            onChange={(logic) => onChange({ requiredIf: logic })}
            targets={targets}
          />
        </Section>
      )}
      <StateAndRoleRules definition={definition} field={field} input={input} onChange={onChange} />
      {issues
        .filter((i) => i.field === field.key && i.code !== 'formula' && i.code !== 'cycle')
        .map((issue, index) => (
          <p key={index} className="text-xs text-danger" role="alert">
            {issue.message}
          </p>
        ))}
    </div>
  );
}
