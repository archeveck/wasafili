import { type Field, type JsonLogic } from '@tesserax/form-schema';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/form-controls';
import {
  CONDITION_OPERATORS,
  type ConditionModel,
  type ConditionOperator,
  conditionToLogic,
  logicToCondition,
} from './model';

export interface ConditionTarget {
  variable: string;
  label: string;
  field: Field;
}

type Logic = Record<string, JsonLogic> | undefined;

/** Éditeur visuel de condition, générant du json-logic ; mode avancé pour les expressions libres. */
export function ConditionEditor({
  value,
  onChange,
  targets,
  idPrefix,
}: {
  value: Logic;
  onChange: (logic: Logic) => void;
  targets: ConditionTarget[];
  idPrefix: string;
}) {
  const parsed = logicToCondition(value);
  const [advanced, setAdvanced] = useState(!parsed);
  const [raw, setRaw] = useState(() => JSON.stringify(value ?? {}, null, 2));
  const [rawError, setRawError] = useState<string>();
  const model: ConditionModel = parsed ?? { combinator: 'and', rules: [] };

  const update = (next: ConditionModel) => onChange(conditionToLogic(next));

  if (advanced) {
    return (
      <div className="space-y-2">
        <Textarea
          aria-label="Condition json-logic"
          className="font-mono text-xs"
          rows={5}
          value={raw}
          onChange={(event) => {
            setRaw(event.target.value);
            try {
              const logic = JSON.parse(event.target.value) as Record<string, JsonLogic>;
              setRawError(undefined);
              onChange(Object.keys(logic).length ? logic : undefined);
            } catch {
              setRawError('JSON invalide');
            }
          }}
        />
        {rawError && <p className="text-xs text-danger">{rawError}</p>}
        {parsed && (
          <Button size="sm" variant="link" className="px-0" onClick={() => setAdvanced(false)}>
            Revenir à l’éditeur visuel
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {model.rules.length > 1 && (
        <Select
          aria-label="Combinaison des règles"
          value={model.combinator}
          onChange={(event) => update({ ...model, combinator: event.target.value as 'and' | 'or' })}
        >
          <option value="and">Toutes les règles (ET)</option>
          <option value="or">Au moins une règle (OU)</option>
        </Select>
      )}
      {model.rules.map((rule, index) => {
        const target = targets.find((t) => t.variable === rule.variable);
        const unary = CONDITION_OPERATORS.find((op) => op.value === rule.operator)?.unary;
        const options =
          target && (target.field.type === 'select' || target.field.type === 'multiselect')
            ? target.field.options
            : undefined;
        const set = (patch: Partial<typeof rule>) =>
          update({
            ...model,
            rules: model.rules.map((r, i) => (i === index ? { ...r, ...patch } : r)),
          });
        return (
          <div key={index} className="space-y-1.5 rounded-md border border-border p-2">
            <div className="flex gap-1.5">
              <Select
                aria-label="Champ"
                id={`${idPrefix}-var-${index}`}
                value={rule.variable}
                onChange={(e) => set({ variable: e.target.value })}
              >
                <option value="">— Champ —</option>
                {targets.map((t) => (
                  <option key={t.variable} value={t.variable}>
                    {t.label}
                  </option>
                ))}
              </Select>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Retirer la règle"
                onClick={() =>
                  update({ ...model, rules: model.rules.filter((_, i) => i !== index) })
                }
              >
                <Trash2 className="text-danger" />
              </Button>
            </div>
            <Select
              aria-label="Opérateur"
              value={rule.operator}
              onChange={(e) => set({ operator: e.target.value as ConditionOperator })}
            >
              {CONDITION_OPERATORS.map((op) => (
                <option key={op.value} value={op.value}>
                  {op.label}
                </option>
              ))}
            </Select>
            {!unary &&
              (options && rule.operator !== 'in' ? (
                <Select
                  aria-label="Valeur"
                  value={rule.value}
                  onChange={(e) => set({ value: e.target.value })}
                >
                  <option value="">— Valeur —</option>
                  {options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              ) : target?.field.type === 'boolean' ? (
                <Select
                  aria-label="Valeur"
                  value={rule.value}
                  onChange={(e) => set({ value: e.target.value })}
                >
                  <option value="true">Oui</option>
                  <option value="false">Non</option>
                </Select>
              ) : (
                <Input
                  aria-label="Valeur"
                  value={rule.value}
                  onChange={(e) => set({ value: e.target.value })}
                  placeholder="Valeur"
                />
              ))}
          </div>
        );
      })}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            update({
              ...model,
              rules: [
                ...model.rules,
                { variable: targets[0]?.variable ?? '', operator: '==', value: '' },
              ],
            })
          }
          disabled={targets.length === 0}
        >
          <Plus /> Ajouter une règle
        </Button>
        <Button
          size="sm"
          variant="link"
          onClick={() => {
            setRaw(JSON.stringify(value ?? {}, null, 2));
            setAdvanced(true);
          }}
        >
          Mode avancé
        </Button>
      </div>
    </div>
  );
}
