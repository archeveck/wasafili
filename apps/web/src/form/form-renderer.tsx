import { type FieldState } from '@wasafili/form-engine';
import {
  errorsAt,
  type FieldServices,
  type FormController,
  validationMessage,
} from '@wasafili/form-renderer';
import {
  type Field,
  type SimpleField,
  type StructureDefinition,
  type TableField,
  type TableRow,
} from '@wasafili/form-schema';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { FormRow } from '@/components/ui/form-controls';
import { cn } from '@/lib/utils';
import { FieldInput } from './fields';

interface RendererProps {
  definition: StructureDefinition;
  form: FormController;
  services: FieldServices;
  /** Préfixe des identifiants DOM (plusieurs formulaires sur une page). */
  idPrefix?: string;
  compact?: boolean;
}

function SimpleFieldRow({
  field,
  state,
  value,
  onChange,
  path,
  scope,
  props,
}: {
  field: SimpleField;
  state: FieldState;
  value: unknown;
  onChange: (value: unknown) => void;
  path: (string | number)[];
  scope: Record<string, unknown>;
  props: RendererProps;
}) {
  const { t } = useTranslation();
  if (!state.visible) return null;
  const inputId = `${props.idPrefix ?? 'f'}-${path.join('-')}`;
  const errors = props.form.submitted ? errorsAt(props.form.errors, path) : [];
  const input = (
    <FieldInput
      field={field}
      value={value}
      onChange={onChange}
      state={state}
      errors={errors}
      inputId={inputId}
      services={props.services}
      scope={scope}
    />
  );
  if (field.type === 'info') {
    return (
      <div className="rounded-md bg-subtle p-3">
        <p className="mb-1 text-sm font-medium">{field.label}</p>
        {input}
      </div>
    );
  }
  return (
    <FormRow
      label={field.label}
      htmlFor={inputId}
      required={state.required}
      help={field.help}
      error={errors[0] ? validationMessage(errors[0], t) : undefined}
    >
      {input}
    </FormRow>
  );
}

function TableBlock({ table, props }: { table: TableField; props: RendererProps }) {
  const { t } = useTranslation();
  const { form } = props;
  const state = form.state.fields[table.key]!;
  if (!state.visible) return null;
  const rows = (Array.isArray(form.values[table.key]) ? form.values[table.key] : []) as TableRow[];
  const rowStates = form.state.rows[table.key] ?? [];
  const tableErrors = form.submitted ? errorsAt(form.errors, [table.key]) : [];
  return (
    <fieldset className="space-y-3 rounded-lg border border-border p-4">
      <legend className="px-1 text-sm font-medium">
        {table.label}
        {state.required && <span className="ml-0.5 text-danger">*</span>}
      </legend>
      {rows.map((row, index) => (
        <div key={row._id} className="rounded-md border border-border bg-subtle/50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted">Ligne {index + 1}</span>
            {!state.readOnly && (
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Supprimer la ligne ${index + 1}`}
                onClick={() => form.removeRow(table.key, index)}
              >
                <Trash2 className="text-danger" />
              </Button>
            )}
          </div>
          <div className={cn('grid gap-3', props.compact ? 'grid-cols-1' : 'sm:grid-cols-2')}>
            {table.fields.map((cell) => (
              <SimpleFieldRow
                key={cell.id}
                field={cell}
                state={rowStates[index]?.[cell.key] ?? state}
                value={row[cell.key]}
                onChange={(value) => form.setCell(table.key, index, cell.key, value)}
                path={[table.key, index, cell.key]}
                scope={row}
                props={props}
              />
            ))}
          </div>
        </div>
      ))}
      {tableErrors[0] && (
        <p className="text-xs text-danger" role="alert">
          {validationMessage(tableErrors[0], t)}
        </p>
      )}
      {!state.readOnly && (table.maxRows === undefined || rows.length < table.maxRows) && (
        <Button size="sm" variant="outline" onClick={() => form.addRow(table.key)}>
          <Plus /> Ajouter une ligne
        </Button>
      )}
    </fieldset>
  );
}

function Block({ field, props }: { field: Field; props: RendererProps }) {
  const { form } = props;
  if (field.type === 'table') return <TableBlock table={field} props={props} />;
  if (field.type === 'section') {
    if (!form.state.fields[field.key]?.visible) return null;
    return (
      <section className="space-y-4">
        <h2 className="border-b border-border pb-1 text-base font-semibold">{field.label}</h2>
        {field.help && <p className="text-sm text-muted">{field.help}</p>}
        {field.fields.map((child) => (
          <Block key={child.id} field={child} props={props} />
        ))}
      </section>
    );
  }
  return (
    <SimpleFieldRow
      field={field}
      state={form.state.fields[field.key]!}
      value={form.values[field.key]}
      onChange={(value) => form.setValue(field.key, value)}
      path={[field.key]}
      scope={form.values}
      props={props}
    />
  );
}

/** Rendu complet d'un formulaire : sections, tableaux répétables, conditions et calculs en direct. */
export function FormRenderer(props: RendererProps) {
  return (
    <div className="space-y-5">
      {props.definition.fields.map((field) => (
        <Block key={field.id} field={field} props={props} />
      ))}
    </div>
  );
}
